package app.lifeos.twa;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Versioned, verified installation of the bundled model; no network access. */
final class SpeechModelStore {
    static final String NAME = "vosk-model-small-en-us-0.15";
    static final String ASSET = "speech/" + NAME + ".zip";
    static final String SHA256 = "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498";
    private static final long EXPANDED_BYTES = 70_898_967L;
    interface Archive { InputStream open() throws IOException; }

    private SpeechModelStore() {}

    // Called only on the shared engine worker. Marker publication is atomic;
    // a killed process cannot leave an incomplete model marked as installed.
    static File prepare(File parent, Archive archive) throws IOException {
        File root = new File(parent, NAME + "-" + SHA256.substring(0, 12));
        File marker = new File(root, ".complete");
        if (marker.isFile() && marker.length() == SHA256.length()
                && new File(root, "am/final.mdl").isFile()
                && new File(root, "graph/HCLr.fst").isFile()
                && new File(root, "conf/model.conf").isFile()) {
            byte[] bytes = new byte[SHA256.length()];
            try (InputStream input = new FileInputStream(marker)) {
                if (input.read(bytes) == bytes.length && SHA256.equals(new String(bytes, StandardCharsets.US_ASCII))) return root;
            }
        }
        mkdir(parent);
        File staging = new File(parent, root.getName() + ".installing");
        delete(staging);
        mkdir(staging);
        try {
            extract(archive, staging);
            try (FileOutputStream output = new FileOutputStream(new File(staging, ".complete"))) {
                output.write(SHA256.getBytes(StandardCharsets.US_ASCII));
                output.getFD().sync();
            }
            delete(root);
            if (!staging.renameTo(root)) throw new IOException("model_install_failed");
            return root;
        } finally { delete(staging); }
    }

    private static void extract(Archive archive, File staging) throws IOException {
        MessageDigest digest;
        try { digest = MessageDigest.getInstance("SHA-256"); }
        catch (NoSuchAlgorithmException e) { throw new IOException(e); }
        long total = 0;
        int entries = 0;
        String prefix = staging.getCanonicalPath() + File.separator;
        byte[] buffer = new byte[64 * 1024];
        try (DigestInputStream input = new DigestInputStream(new BufferedInputStream(archive.open()), digest);
             ZipInputStream zip = new ZipInputStream(input)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (++entries > 100 || !entry.getName().startsWith(NAME + "/")) throw new IOException("invalid_model_archive");
                String relative = entry.getName().substring(NAME.length() + 1);
                if (relative.isEmpty()) continue;
                File file = new File(staging, relative);
                if (!file.getCanonicalPath().startsWith(prefix)) throw new IOException("invalid_model_path");
                if (entry.isDirectory()) { mkdir(file); continue; }
                mkdir(file.getParentFile());
                try (FileOutputStream output = new FileOutputStream(file)) {
                    int count;
                    while ((count = zip.read(buffer)) != -1) {
                        total += count;
                        if (total > EXPANDED_BYTES) throw new IOException("invalid_model_size");
                        output.write(buffer, 0, count);
                    }
                }
                zip.closeEntry();
            }
            // ZipInputStream may stop before the archive's central directory.
            // Drain the underlying digest stream so the hash covers every byte.
            while (input.read(buffer) != -1) { }
        }
        StringBuilder actual = new StringBuilder();
        for (byte value : digest.digest()) actual.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        if (total != EXPANDED_BYTES || !SHA256.equals(actual.toString())) throw new IOException("model_checksum_failed");
    }

    private static void mkdir(File directory) throws IOException {
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("model_storage_unavailable");
    }

    private static void delete(File file) throws IOException {
        if (!file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) delete(child);
        if (!file.delete()) throw new IOException("model_storage_cleanup_failed");
    }
}
