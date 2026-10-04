# Linux build + headless test environment for the native playground
# (CI's native-linux job runs the same steps on ubuntu-latest).
#   docker build -t ceangal2-linux -f tools/docker/linux.Dockerfile tools/docker
#   docker run --rm -v "$PWD":/src -v ceangal2-cargo:/root/.cargo/registry ceangal2-linux \
#     bash -c 'tools/build_native.sh && node tests/e2e/native.mjs'
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git build-essential pkg-config unzip python3 \
      mesa-vulkan-drivers libvulkan1 vulkan-tools \
      libxkbcommon0 libwayland-client0 libx11-6 libxcursor1 libxrandr2 libxi6 \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal
ENV PATH=/root/.cargo/bin:$PATH
WORKDIR /src
