package dev.ceangal;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * The system file picker for a NativeActivity app, which cannot receive an
 * activity result itself: this transparent activity opens the picker,
 * reads the file the user chose and hands it to the app's native code
 * (ceangal_platform registers {@link #picked}), then closes.
 */
public final class PickerActivity extends Activity {
    /** status 200 with the file, 499 when cancelled, 0 with the reason. */
    static native void picked(int status, String name, byte[] data);

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        // recreated while the picker is up: it will answer the new instance
        if (saved != null) return;
        Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        String type = getIntent().getStringExtra("type");
        pick.setType(type != null ? type : "*/*");
        try {
            startActivityForResult(pick, 1);
        } catch (Exception e) {
            picked(0, "", ("no file picker: " + e).getBytes());
            finish();
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        Uri uri = data == null ? null : data.getData();
        if (result != RESULT_OK || uri == null) {
            picked(499, "", new byte[0]);
        } else {
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                picked(200, nameOf(uri), out.toByteArray());
            } catch (Exception e) {
                picked(0, "", e.toString().getBytes());
            }
        }
        finish();
        overridePendingTransition(0, 0);
    }

    private String nameOf(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception e) {
            // the name is only a courtesy
        }
        return "";
    }
}
