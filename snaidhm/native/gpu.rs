//! Native (wgpu) implementation of the `gpu` namespace — docs/abi.md §4.2.
//!
//! * One `wgpu::Device` per process ([`shared`]); every guest instance gets
//!   its own [`GpuContext`] with its own handle table, so the playground and
//!   a user program never see each other's objects, and dropping a context
//!   releases everything it created (Stop).
//! * The `@extern(rust)` functions at the bottom act on the thread's current
//!   context, which the host sets with [`enter`] around every call into the
//!   guest. The wasm shim (user GUI programs) calls the same `GpuContext`
//!   methods with slices of the instance's memory.
//! * A context renders either to a window surface ([`GpuContext::attach_surface`])
//!   or to an offscreen texture ([`GpuContext::set_offscreen`]) — headless
//!   tests and user programs composited into the playground use the latter.

#![allow(dead_code)]

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::{Mutex, OnceLock};

pub struct Shared {
    pub instance: wgpu::Instance,
    pub adapter: wgpu::Adapter,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
}

static SHARED: OnceLock<Option<Shared>> = OnceLock::new();

/// The process-wide device. `None` (and a one-time warning) when no adapter
/// exists; every gpu call then degrades to a no-op returning the null handle.
pub fn shared() -> Option<&'static Shared> {
    SHARED
        .get_or_init(|| {
            let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
            init_with(instance, None)
        })
        .as_ref()
}

/// Whether the shared device exists yet (without creating it).
pub fn shared_ready() -> bool {
    SHARED.get().is_some()
}

/// Initialise the shared device for a given instance and (optionally) a
/// surface the adapter must be able to present to. The windowed host calls
/// this before anything else touches [`shared`].
pub fn init_shared(instance: wgpu::Instance, surface: Option<&wgpu::Surface<'_>>) -> Option<&'static Shared> {
    SHARED.get_or_init(|| init_with(instance, surface)).as_ref()
}

/// Like [`init_shared`], but leaves the device unset when this instance has
/// no adapter for the surface, so the caller can try other backends.
pub fn try_init_shared(instance: wgpu::Instance, surface: &wgpu::Surface<'_>) -> bool {
    if SHARED.get().is_some() {
        return true;
    }
    match init_with(instance, Some(surface)) {
        Some(sh) => { let _ = SHARED.set(Some(sh)); true }
        None => false,
    }
}

fn init_with(instance: wgpu::Instance, surface: Option<&wgpu::Surface<'_>>) -> Option<Shared> {
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::LowPower,
        compatible_surface: surface,
        force_fallback_adapter: false,
        apply_limit_buckets: false,
    }));
    let adapter = match adapter {
        Ok(a) => a,
        Err(e) => {
            eprintln!("snaidhm: no GPU adapter ({e}); rendering disabled");
            return None;
        }
    };
    let limits = wgpu::Limits::downlevel_defaults().using_resolution(adapter.limits());
    let desc = wgpu::DeviceDescriptor {
        label: Some("snaidhm"),
        required_features: wgpu::Features::empty(),
        required_limits: limits,
        ..Default::default()
    };
    match pollster::block_on(adapter.request_device(&desc)) {
        Ok((device, queue)) => Some(Shared { instance, adapter, device, queue }),
        Err(e) => {
            eprintln!("snaidhm: no GPU device ({e}); rendering disabled");
            None
        }
    }
}

// ── Formats and enums (docs/abi.md §4.2) ─────────────────────────────────

pub const FORMAT_BGRA8: i64 = 1;
pub const FORMAT_RGBA8: i64 = 2;
pub const FORMAT_R8: i64 = 3;

fn format_of(code: i64) -> wgpu::TextureFormat {
    match code {
        FORMAT_RGBA8 => wgpu::TextureFormat::Rgba8Unorm,
        FORMAT_R8 => wgpu::TextureFormat::R8Unorm,
        _ => wgpu::TextureFormat::Bgra8Unorm,
    }
}

fn code_of(format: wgpu::TextureFormat) -> i64 {
    match format {
        wgpu::TextureFormat::Rgba8Unorm => FORMAT_RGBA8,
        wgpu::TextureFormat::R8Unorm => FORMAT_R8,
        _ => FORMAT_BGRA8,
    }
}

fn bytes_per_texel(format: wgpu::TextureFormat) -> u32 {
    if format == wgpu::TextureFormat::R8Unorm { 1 } else { 4 }
}

// ── Contexts ─────────────────────────────────────────────────────────────

enum Res {
    Free,
    Shader(wgpu::ShaderModule),
    Pipeline(wgpu::RenderPipeline),
    Buffer(wgpu::Buffer),
    Texture { texture: wgpu::Texture, view: wgpu::TextureView, format: wgpu::TextureFormat },
    Sampler(wgpu::Sampler),
    BindGroup(wgpu::BindGroup),
    /// The frame's render target (surface texture or offscreen view).
    Target { view: wgpu::TextureView, width: u32, height: u32 },
    Pass(wgpu::RenderPass<'static>),
}

enum Binding {
    Buffer(usize),
    Texture(usize),
    Sampler(usize),
}

struct SurfaceState {
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
}

struct Offscreen {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    width: u32,
    height: u32,
}

pub struct GpuContext {
    pub id: u64,
    res: Vec<Res>,
    free: Vec<usize>,
    bindings: Vec<(u32, Binding)>,
    encoder: Option<wgpu::CommandEncoder>,
    frame: Option<wgpu::SurfaceTexture>,
    surface: Option<SurfaceState>,
    offscreen: Option<Offscreen>,
    format: wgpu::TextureFormat,
    /// Upper bound on live handles; exceeding it refuses the allocation
    /// (user programs; docs/abi.md §5).
    pub max_handles: usize,
}

static NEXT_ID: Mutex<u64> = Mutex::new(1);

/// Offscreen targets other contexts may sample (`external_texture`), keyed
/// by context id.
static EXTERNAL: Mutex<Option<HashMap<u64, wgpu::Texture>>> = Mutex::new(None);

impl GpuContext {
    pub fn new() -> Self {
        let id = {
            let mut n = NEXT_ID.lock().unwrap();
            let id = *n;
            *n += 1;
            id
        };
        GpuContext {
            id,
            res: vec![Res::Free],
            free: Vec::new(),
            bindings: Vec::new(),
            encoder: None,
            frame: None,
            surface: None,
            offscreen: None,
            format: wgpu::TextureFormat::Bgra8Unorm,
            max_handles: usize::MAX,
        }
    }

    /// Render into a window from now on.
    pub fn attach_surface(&mut self, surface: wgpu::Surface<'static>, width: u32, height: u32) {
        let Some(sh) = shared() else { return };
        let caps = surface.get_capabilities(&sh.adapter);
        // Non-sRGB, so blending happens in the same space as a WebGPU canvas.
        let format = [wgpu::TextureFormat::Bgra8Unorm, wgpu::TextureFormat::Rgba8Unorm]
            .into_iter()
            .find(|f| caps.formats.contains(f))
            .unwrap_or(caps.formats[0]);
        let alpha_mode = if caps.alpha_modes.contains(&wgpu::CompositeAlphaMode::Opaque) {
            wgpu::CompositeAlphaMode::Opaque
        } else {
            caps.alpha_modes[0]
        };
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: width.max(1),
            height: height.max(1),
            present_mode: wgpu::PresentMode::Fifo,
            desired_maximum_frame_latency: 2,
            alpha_mode,
            view_formats: vec![],
            color_space: Default::default(),
        };
        surface.configure(&sh.device, &config);
        self.format = format;
        self.surface = Some(SurfaceState { surface, config });
    }

    pub fn has_surface(&self) -> bool {
        self.surface.is_some()
    }

    /// Drop the window surface (mobile apps lose their native window while
    /// suspended); `attach_surface` again on resume.
    pub fn detach_surface(&mut self) {
        self.frame = None;
        self.surface = None;
    }

    pub fn resize_surface(&mut self, width: u32, height: u32) {
        let Some(sh) = shared() else { return };
        if let Some(s) = &mut self.surface {
            s.config.width = width.max(1);
            s.config.height = height.max(1);
            s.surface.configure(&sh.device, &s.config);
        }
    }

    /// Render into an offscreen texture of this size from now on (headless
    /// runs, user programs composited by the playground).
    pub fn set_offscreen(&mut self, width: u32, height: u32) {
        let Some(sh) = shared() else { return };
        let (width, height) = (width.max(1), height.max(1));
        if let Some(o) = &self.offscreen {
            if o.width == width && o.height == height {
                return;
            }
        }
        let texture = sh.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("snaidhm offscreen"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Bgra8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        EXTERNAL.lock().unwrap().get_or_insert_with(HashMap::new).insert(self.id, texture.clone());
        self.format = wgpu::TextureFormat::Bgra8Unorm;
        self.offscreen = Some(Offscreen { texture, view, width, height });
    }

    /// Copy the offscreen target out as tightly packed RGBA8 rows.
    pub fn read_offscreen_rgba(&mut self) -> Option<(u32, u32, Vec<u8>)> {
        let sh = shared()?;
        let o = self.offscreen.as_ref()?;
        let (w, h) = (o.width, o.height);
        let padded = (w * 4 + 255) / 256 * 256;
        let buf = sh.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("snaidhm readback"),
            size: (padded * h) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut enc = sh.device.create_command_encoder(&Default::default());
        enc.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &o.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &buf,
                layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(padded), rows_per_image: Some(h) },
            },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        sh.queue.submit([enc.finish()]);
        let slice = buf.slice(..);
        slice.map_async(wgpu::MapMode::Read, |_| {});
        let _ = sh.device.poll(wgpu::PollType::Wait { submission_index: None, timeout: None });
        let Ok(data) = slice.get_mapped_range() else { return None };
        let mut out = Vec::with_capacity((w * h * 4) as usize);
        for row in 0..h {
            let start = (row * padded) as usize;
            for px in data[start..start + (w * 4) as usize].chunks_exact(4) {
                out.extend_from_slice(&[px[2], px[1], px[0], px[3]]); // BGRA -> RGBA
            }
        }
        drop(data);
        buf.unmap();
        Some((w, h, out))
    }

    // ── handle table ──

    fn put(&mut self, r: Res) -> i64 {
        if self.res.len() - self.free.len() > self.max_handles {
            return 0;
        }
        if let Some(i) = self.free.pop() {
            self.res[i] = r;
            i as i64
        } else {
            self.res.push(r);
            (self.res.len() - 1) as i64
        }
    }

    fn get(&self, h: i64) -> Option<&Res> {
        if h <= 0 { None } else { self.res.get(h as usize) }
    }

    pub fn release(&mut self, h: i64) {
        if h > 0 && (h as usize) < self.res.len() && !matches!(self.res[h as usize], Res::Free) {
            self.res[h as usize] = Res::Free;
            self.free.push(h as usize);
        }
    }

    pub fn live_handles(&self) -> usize {
        self.res.len() - 1 - self.free.len()
    }

    // ── ABI operations ──

    pub fn surface_format(&self) -> i64 {
        code_of(self.format)
    }

    pub fn create_shader(&mut self, src: &[u8]) -> i64 {
        let Some(sh) = shared() else { return 0 };
        let Ok(text) = std::str::from_utf8(src) else { return 0 };
        let module = sh.device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: None,
            source: wgpu::ShaderSource::Wgsl(text.into()),
        });
        self.put(Res::Shader(module))
    }

    pub fn create_render_pipeline(&mut self, shader: i64, vs: &[u8], fs: &[u8], format: i64, blend: i64) -> i64 {
        let Some(sh) = shared() else { return 0 };
        let Some(Res::Shader(module)) = self.get(shader) else { return 0 };
        let (Ok(vs), Ok(fs)) = (std::str::from_utf8(vs), std::str::from_utf8(fs)) else { return 0 };
        let format = if format == 0 { self.format } else { format_of(format) };
        let blend = if blend == 1 { Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING) } else { None };
        let p = sh.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: None,
            layout: None,
            vertex: wgpu::VertexState {
                module,
                entry_point: Some(vs),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module,
                entry_point: Some(fs),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState { format, blend, write_mask: wgpu::ColorWrites::ALL })],
            }),
            multiview_mask: None,
            cache: None,
        });
        self.put(Res::Pipeline(p))
    }

    pub fn create_buffer(&mut self, size: i64, usage: i64) -> i64 {
        let Some(sh) = shared() else { return 0 };
        let size = ((size.max(4) + 3) / 4 * 4) as u64;
        let b = sh.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size,
            usage: wgpu::BufferUsages::from_bits_truncate(usage as u32),
            mapped_at_creation: false,
        });
        self.put(Res::Buffer(b))
    }

    pub fn write_buffer(&mut self, buffer: i64, offset: i64, data: &[u8]) {
        let Some(sh) = shared() else { return };
        let Some(Res::Buffer(b)) = self.get(buffer) else { return };
        let end = (offset as u64).saturating_add(data.len() as u64);
        if end > b.size() || data.len() % 4 != 0 || offset % 4 != 0 {
            return;
        }
        sh.queue.write_buffer(b, offset as u64, data);
    }

    pub fn create_texture(&mut self, width: i64, height: i64, format: i64, usage: i64) -> i64 {
        let Some(sh) = shared() else { return 0 };
        let format = format_of(format);
        let texture = sh.device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d { width: width.max(1) as u32, height: height.max(1) as u32, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::from_bits_truncate(usage as u32),
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        self.put(Res::Texture { texture, view, format })
    }

    pub fn write_texture(&mut self, texture: i64, x: i64, y: i64, width: i64, height: i64, data: &[u8], bytes_per_row: i64) {
        let Some(sh) = shared() else { return };
        let Some(Res::Texture { texture, format, .. }) = self.get(texture) else { return };
        if width <= 0 || height <= 0 {
            return;
        }
        let need = bytes_per_row as usize * (height as usize - 1) + width as usize * bytes_per_texel(*format) as usize;
        if data.len() < need {
            return;
        }
        sh.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: 0,
                origin: wgpu::Origin3d { x: x as u32, y: y as u32, z: 0 },
                aspect: wgpu::TextureAspect::All,
            },
            data,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(bytes_per_row as u32), rows_per_image: Some(height as u32) },
            wgpu::Extent3d { width: width as u32, height: height as u32, depth_or_array_layers: 1 },
        );
    }

    pub fn create_sampler(&mut self, filter: i64) -> i64 {
        let Some(sh) = shared() else { return 0 };
        let f = if filter == 1 { wgpu::FilterMode::Linear } else { wgpu::FilterMode::Nearest };
        let s = sh.device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: f,
            min_filter: f,
            ..Default::default()
        });
        self.put(Res::Sampler(s))
    }

    pub fn bind_begin(&mut self) {
        self.bindings.clear();
    }

    pub fn bind_buffer(&mut self, binding: i64, h: i64) {
        self.bindings.push((binding as u32, Binding::Buffer(h as usize)));
    }

    pub fn bind_texture(&mut self, binding: i64, h: i64) {
        self.bindings.push((binding as u32, Binding::Texture(h as usize)));
    }

    pub fn bind_sampler(&mut self, binding: i64, h: i64) {
        self.bindings.push((binding as u32, Binding::Sampler(h as usize)));
    }

    pub fn bind_create(&mut self, pipeline: i64, group: i64) -> i64 {
        let Some(sh) = shared() else { return 0 };
        let Some(Res::Pipeline(p)) = self.get(pipeline) else { return 0 };
        let layout = p.get_bind_group_layout(group as u32);
        let mut entries = Vec::new();
        for (binding, b) in &self.bindings {
            let resource = match b {
                Binding::Buffer(h) => match self.res.get(*h) {
                    Some(Res::Buffer(buf)) => buf.as_entire_binding(),
                    _ => return 0,
                },
                Binding::Texture(h) => match self.res.get(*h) {
                    Some(Res::Texture { view, .. }) => wgpu::BindingResource::TextureView(view),
                    _ => return 0,
                },
                Binding::Sampler(h) => match self.res.get(*h) {
                    Some(Res::Sampler(s)) => wgpu::BindingResource::Sampler(s),
                    _ => return 0,
                },
            };
            entries.push(wgpu::BindGroupEntry { binding: *binding, resource });
        }
        let bg = sh.device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: &layout, entries: &entries });
        self.bindings.clear();
        self.put(Res::BindGroup(bg))
    }

    pub fn frame_begin(&mut self) -> i64 {
        let Some(sh) = shared() else { return 0 };
        let (view, width, height) = if let Some(o) = &self.offscreen {
            (o.view.clone(), o.width, o.height)
        } else if let Some(s) = &self.surface {
            let tex = match s.surface.get_current_texture() {
                wgpu::CurrentSurfaceTexture::Success(t) | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
                wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                    s.surface.configure(&sh.device, &s.config);
                    return 0;
                }
                _ => return 0,
            };
            let view = tex.texture.create_view(&Default::default());
            let (w, h) = (tex.texture.width(), tex.texture.height());
            self.frame = Some(tex);
            (view, w, h)
        } else {
            return 0;
        };
        self.encoder = Some(sh.device.create_command_encoder(&Default::default()));
        self.put(Res::Target { view, width, height })
    }

    pub fn target_width(&self, t: i64) -> i64 {
        match self.get(t) {
            Some(Res::Target { width, .. }) => *width as i64,
            Some(Res::Texture { texture, .. }) => texture.width() as i64,
            _ => 0,
        }
    }

    pub fn target_height(&self, t: i64) -> i64 {
        match self.get(t) {
            Some(Res::Target { height, .. }) => *height as i64,
            Some(Res::Texture { texture, .. }) => texture.height() as i64,
            _ => 0,
        }
    }

    pub fn pass_begin(&mut self, target: i64, load: i64, r: f64, g: f64, b: f64, a: f64) -> i64 {
        let view = match self.get(target) {
            Some(Res::Target { view, .. }) => view.clone(),
            Some(Res::Texture { view, .. }) => view.clone(),
            _ => return 0,
        };
        let Some(enc) = self.encoder.as_mut() else { return 0 };
        let load = if load == 1 { wgpu::LoadOp::Load } else { wgpu::LoadOp::Clear(wgpu::Color { r, g, b, a }) };
        let pass = enc
            .begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load, store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            })
            .forget_lifetime();
        self.put(Res::Pass(pass))
    }

    fn with_pass<R: Default>(&mut self, pass: i64, f: impl FnOnce(&mut wgpu::RenderPass<'static>, &Vec<Res>) -> R) -> R {
        if pass <= 0 || pass as usize >= self.res.len() {
            return R::default();
        }
        let mut taken = std::mem::replace(&mut self.res[pass as usize], Res::Free);
        let r = match &mut taken {
            Res::Pass(p) => f(p, &self.res),
            _ => R::default(),
        };
        self.res[pass as usize] = taken;
        r
    }

    pub fn pass_pipeline(&mut self, pass: i64, pipeline: i64) {
        self.with_pass(pass, |p, res| {
            if let Some(Res::Pipeline(pl)) = res.get(pipeline as usize) {
                p.set_pipeline(pl);
            }
        })
    }

    pub fn pass_bind(&mut self, pass: i64, index: i64, group: i64) {
        self.with_pass(pass, |p, res| {
            if let Some(Res::BindGroup(bg)) = res.get(group as usize) {
                p.set_bind_group(index as u32, bg, &[]);
            }
        })
    }

    pub fn pass_scissor(&mut self, pass: i64, x: i64, y: i64, w: i64, h: i64) {
        self.with_pass(pass, |p, _| p.set_scissor_rect(x.max(0) as u32, y.max(0) as u32, w.max(0) as u32, h.max(0) as u32))
    }

    pub fn pass_draw(&mut self, pass: i64, vertices: i64, instances: i64, first_vertex: i64, first_instance: i64) {
        self.with_pass(pass, |p, _| {
            let v = first_vertex as u32..(first_vertex + vertices) as u32;
            let i = first_instance as u32..(first_instance + instances) as u32;
            p.draw(v, i);
        })
    }

    pub fn pass_end(&mut self, pass: i64) {
        // Dropping the pass ends it.
        self.release(pass);
    }

    pub fn frame_submit(&mut self) {
        let Some(sh) = shared() else { return };
        // Any pass the guest forgot to end must end before the encoder finishes.
        for (i, r) in self.res.iter_mut().enumerate() {
            if matches!(r, Res::Pass(_) | Res::Target { .. }) {
                *r = Res::Free;
                self.free.push(i);
            }
        }
        if let Some(enc) = self.encoder.take() {
            sh.queue.submit([enc.finish()]);
        }
        if let Some(frame) = self.frame.take() {
            sh.queue.present(frame);
        }
    }

    pub fn external_texture(&mut self, context_id: i64) -> i64 {
        let tex = EXTERNAL.lock().unwrap().as_ref().and_then(|m| m.get(&(context_id as u64)).cloned());
        match tex {
            Some(texture) => {
                let view = texture.create_view(&Default::default());
                let format = texture.format();
                self.put(Res::Texture { texture, view, format })
            }
            None => 0,
        }
    }
}

impl Drop for GpuContext {
    fn drop(&mut self) {
        if let Ok(mut m) = EXTERNAL.lock() {
            if let Some(m) = m.as_mut() {
                m.remove(&self.id);
            }
        }
    }
}

// ── Current context (set by the host around guest calls) ─────────────────

thread_local! {
    static CURRENT: RefCell<Option<Rc<RefCell<GpuContext>>>> = const { RefCell::new(None) };
}

/// Run `f` with `ctx` as the current context for the `@extern(rust)` calls it makes.
pub fn enter<R>(ctx: &Rc<RefCell<GpuContext>>, f: impl FnOnce() -> R) -> R {
    let prev = CURRENT.with(|c| c.replace(Some(ctx.clone())));
    let r = f();
    CURRENT.with(|c| *c.borrow_mut() = prev);
    r
}

fn with<R: Default>(f: impl FnOnce(&mut GpuContext) -> R) -> R {
    CURRENT.with(|c| match c.borrow().as_ref() {
        Some(ctx) => f(&mut ctx.borrow_mut()),
        None => R::default(),
    })
}

/// A guest byte range. Natively `ptr` is an address the guest obtained from
/// `bytes.data_ptr` and `len` bytes from it are live for the call.
fn slice<'a>(ptr: i64, len: i64) -> &'a [u8] {
    if ptr == 0 || len <= 0 {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(ptr as usize as *const u8, len as usize) }
    }
}

// ── @extern(rust, "crate::gpu", …) entry points ──────────────────────────

pub fn surface_format() -> i64 { with(|c| c.surface_format()) }
pub fn create_shader(src_ptr: i64, src_len: i64) -> i64 { with(|c| c.create_shader(slice(src_ptr, src_len))) }
pub fn create_render_pipeline(shader: i64, vs_ptr: i64, vs_len: i64, fs_ptr: i64, fs_len: i64, format: i64, blend: i64) -> i64 {
    with(|c| c.create_render_pipeline(shader, slice(vs_ptr, vs_len), slice(fs_ptr, fs_len), format, blend))
}
pub fn create_buffer(size: i64, usage: i64) -> i64 { with(|c| c.create_buffer(size, usage)) }
pub fn write_buffer(buffer: i64, offset: i64, ptr: i64, len: i64) { with(|c| c.write_buffer(buffer, offset, slice(ptr, len))) }
pub fn create_texture(width: i64, height: i64, format: i64, usage: i64) -> i64 { with(|c| c.create_texture(width, height, format, usage)) }
pub fn write_texture(texture: i64, x: i64, y: i64, width: i64, height: i64, ptr: i64, len: i64, bytes_per_row: i64) {
    with(|c| c.write_texture(texture, x, y, width, height, slice(ptr, len), bytes_per_row))
}
pub fn create_sampler(filter: i64) -> i64 { with(|c| c.create_sampler(filter)) }
pub fn bind_begin() { with(|c| c.bind_begin()) }
pub fn bind_buffer(binding: i64, buffer: i64) { with(|c| c.bind_buffer(binding, buffer)) }
pub fn bind_texture(binding: i64, texture: i64) { with(|c| c.bind_texture(binding, texture)) }
pub fn bind_sampler(binding: i64, sampler: i64) { with(|c| c.bind_sampler(binding, sampler)) }
pub fn bind_create(pipeline: i64, group: i64) -> i64 { with(|c| c.bind_create(pipeline, group)) }
pub fn frame_begin() -> i64 { with(|c| c.frame_begin()) }
pub fn target_width(target: i64) -> i64 { with(|c| c.target_width(target)) }
pub fn target_height(target: i64) -> i64 { with(|c| c.target_height(target)) }
pub fn pass_begin(target: i64, load: i64, r: f64, g: f64, b: f64, a: f64) -> i64 { with(|c| c.pass_begin(target, load, r, g, b, a)) }
pub fn pass_pipeline(pass: i64, pipeline: i64) { with(|c| c.pass_pipeline(pass, pipeline)) }
pub fn pass_bind(pass: i64, index: i64, group: i64) { with(|c| c.pass_bind(pass, index, group)) }
pub fn pass_scissor(pass: i64, x: i64, y: i64, width: i64, height: i64) { with(|c| c.pass_scissor(pass, x, y, width, height)) }
pub fn pass_draw(pass: i64, vertices: i64, instances: i64, first_vertex: i64, first_instance: i64) {
    with(|c| c.pass_draw(pass, vertices, instances, first_vertex, first_instance))
}
pub fn pass_end(pass: i64) { with(|c| c.pass_end(pass)) }
pub fn frame_submit() { with(|c| c.frame_submit()) }
pub fn release(handle: i64) { with(|c| c.release(handle)) }
pub fn external_texture(context_id: i64) -> i64 { with(|c| c.external_texture(context_id)) }
