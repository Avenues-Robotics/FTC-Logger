package org.firstinspires.ftc.teamcode.logger.java;

import android.content.Context;

import org.firstinspires.ftc.robotcore.internal.webserver.WebHandler;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

import fi.iki.elonen.NanoHTTPD;

/**
 * Serves a single file from the Android assets folder.
 *
 * Example:
 *  assetPath = "web/index.html"
 * corresponds to:
 *  TeamCode/src/main/java/org/firstinspires/ftc/teamcode/logger/web/index.html
 */
public final class StaticAssetHandler implements WebHandler {

    private final Context context;
    private final String assetPath;
    private final String contentType;

    public StaticAssetHandler(Context context, String assetPath, String contentType) {
        this.context = context.getApplicationContext();
        this.assetPath = assetPath;
        this.contentType = contentType;
    }

    @Override
    public NanoHTTPD.Response getResponse(NanoHTTPD.IHTTPSession session) {
        try (InputStream is = context.getAssets().open(assetPath)) {
            byte[] bytes = readAllBytes(is);
            return NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.OK,
                    contentType,
                    new ByteArrayInputStream(bytes),
                    bytes.length
            );
        } catch (IOException e) {
            return NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.NOT_FOUND,
                    "text/plain; charset=utf-8",
                    "Not found: " + assetPath
            );
        }
    }

    private static byte[] readAllBytes(InputStream is) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int r;
        while ((r = is.read(buf)) != -1) {
            baos.write(buf, 0, r);
        }
        return baos.toByteArray();
    }
}
