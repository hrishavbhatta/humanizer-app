package com.hrishavbhatta.humanizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Manages the optional on-device AI model file in the app's private files directory.
 * The inference plugin (@capgo/capacitor-llm) can download a model but cannot cancel, resume,
 * delete or check it, and it writes straight to the final name, so a half-finished download
 * would look like a model. This plugin downloads to "name.part", resumes with HTTP Range,
 * and renames to the final name only after the byte count matches.
 */
@CapacitorPlugin(name = "ModelFiles")
public class ModelFilesPlugin extends Plugin {

    private static final long MIN_FREE_MARGIN = 100L * 1024 * 1024;
    private final AtomicBoolean cancelled = new AtomicBoolean(false);
    private final AtomicBoolean running = new AtomicBoolean(false);

    private File dir() {
        return getContext().getFilesDir();
    }

    private static String safeName(String name) {
        if (name == null || name.isEmpty() || name.contains("/") || name.contains("\\") || name.contains("..")) {
            return null;
        }
        return name;
    }

    @PluginMethod
    public void status(PluginCall call) {
        String name = safeName(call.getString("filename"));
        long size = call.getLong("size", 0L);
        if (name == null) {
            call.reject("filename is required");
            return;
        }
        File file = new File(dir(), name);
        File part = new File(dir(), name + ".part");
        JSObject ret = new JSObject();
        ret.put("exists", file.isFile() && (size <= 0 || file.length() == size));
        ret.put("path", file.getAbsolutePath());
        ret.put("bytes", file.isFile() ? file.length() : 0L);
        ret.put("partialBytes", part.isFile() ? part.length() : 0L);
        ret.put("downloading", running.get());
        call.resolve(ret);
    }

    @PluginMethod
    public void delete(PluginCall call) {
        String name = safeName(call.getString("filename"));
        if (name == null) {
            call.reject("filename is required");
            return;
        }
        if (running.get()) {
            call.reject("A download is running. Cancel it first.");
            return;
        }
        new File(dir(), name).delete();
        new File(dir(), name + ".part").delete();
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        cancelled.set(true);
        call.resolve();
    }

    @PluginMethod
    public void download(PluginCall call) {
        final String urlString = call.getString("url");
        final String name = safeName(call.getString("filename"));
        final long expected = call.getLong("size", 0L);
        if (urlString == null || name == null || !urlString.startsWith("https://")) {
            call.reject("An https url and a filename are required");
            return;
        }
        if (!running.compareAndSet(false, true)) {
            call.reject("A download is already running");
            return;
        }
        cancelled.set(false);
        new Thread(() -> {
            try {
                File finalFile = new File(dir(), name);
                File part = new File(dir(), name + ".part");
                if (finalFile.isFile() && (expected <= 0 || finalFile.length() == expected)) {
                    JSObject already = new JSObject();
                    already.put("path", finalFile.getAbsolutePath());
                    call.resolve(already);
                    return;
                }
                finalFile.delete();
                long have = part.isFile() ? part.length() : 0L;
                if (expected > 0 && have > expected) {
                    part.delete();
                    have = 0;
                }
                if (expected > 0 && dir().getUsableSpace() < (expected - have) + MIN_FREE_MARGIN) {
                    throw new Exception("Not enough free storage. About 700 MB is needed.");
                }

                HttpURLConnection conn = (HttpURLConnection) new URL(urlString).openConnection();
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(30000);
                conn.setRequestProperty("User-Agent", "HumanizerApp");
                if (have > 0) conn.setRequestProperty("Range", "bytes=" + have + "-");
                int code = conn.getResponseCode();
                boolean append = false;
                if (code == 206) {
                    append = true;
                } else if (code == 200) {
                    have = 0; // server ignored the range: start over
                } else if (code == 416) {
                    part.delete();
                    throw new Exception("The partial download was invalid. Tap Retry.");
                } else {
                    throw new Exception("Download failed (HTTP " + code + ")");
                }
                long total = expected > 0 ? expected : have + conn.getContentLengthLong();

                long done = have;
                long lastEmit = 0;
                byte[] buf = new byte[64 * 1024];
                try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(part, append)) {
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        if (cancelled.get()) throw new CancelledException();
                        out.write(buf, 0, n);
                        done += n;
                        long now = System.currentTimeMillis();
                        if (now - lastEmit > 300) {
                            lastEmit = now;
                            JSObject ev = new JSObject();
                            ev.put("downloaded", done);
                            ev.put("total", total);
                            notifyListeners("modelProgress", ev);
                        }
                    }
                }
                if (expected > 0 && part.length() != expected) {
                    part.delete();
                    throw new Exception("The download was incomplete. Tap Retry.");
                }
                if (!part.renameTo(finalFile)) {
                    throw new Exception("Could not save the model file.");
                }
                JSObject fin = new JSObject();
                fin.put("downloaded", done);
                fin.put("total", total);
                notifyListeners("modelProgress", fin);
                JSObject ret = new JSObject();
                ret.put("path", finalFile.getAbsolutePath());
                call.resolve(ret);
            } catch (CancelledException e) {
                call.reject("cancelled", "CANCELLED");
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Download failed" : e.getMessage());
            } finally {
                running.set(false);
            }
        }).start();
    }

    private static class CancelledException extends Exception {}
}
