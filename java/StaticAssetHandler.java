package org.firstinspires.ftc.teamcode.logger.java;

import org.firstinspires.ftc.robotcore.internal.webserver.WebHandler;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

import fi.iki.elonen.NanoHTTPD;

/**
 * Serves one web UI file (e.g. "index.html") from {@link WebAssets}.
 *
 * The web UI is compiled into the app as WebAssets.java (generated from logger/web/* by
 * dev-tools/build-web-assets.py), so no Gradle or assets-folder setup is needed.
 */
public final class StaticAssetHandler implements WebHandler {

    private final String name;
    private final String contentType;
    private byte[] bytes; // built on first request, then reused

    public StaticAssetHandler(String name, String contentType) {
        this.name = name;
        this.contentType = contentType;
    }

    @Override
    public NanoHTTPD.Response getResponse(NanoHTTPD.IHTTPSession session) {
        byte[] body = content();
        if (body == null) {
            return NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.NOT_FOUND,
                    "text/plain; charset=utf-8",
                    "Not found: web/" + name
            );
        }
        NanoHTTPD.Response response = NanoHTTPD.newFixedLengthResponse(
                NanoHTTPD.Response.Status.OK,
                contentType,
                new ByteArrayInputStream(body),
                body.length
        );
        // Always fetch fresh after a new build is installed.
        response.addHeader("Cache-Control", "no-cache");
        return response;
    }

    private synchronized byte[] content() {
        if (bytes == null) {
            String text = WebAssets.get(name);
            if (text != null) bytes = text.getBytes(StandardCharsets.UTF_8);
        }
        return bytes;
    }
}
