package org.firstinspires.ftc.teamcode.logger.java;

import android.content.Context;

import com.qualcomm.robotcore.util.RobotLog;
import com.qualcomm.robotcore.util.WebHandlerManager;

import org.firstinspires.ftc.ftccommon.external.WebHandlerRegistrar;

/**
 * FTC Logger: registers handlers onto the RC web server (http://192.168.43.1:8080).
 *
 * FTC SDK v11: web handler registration uses a static method annotated with @WebHandlerRegistrar.
 */
public final class Server {
    private static final String TAG = "Server";

    private Server() { }

    @WebHandlerRegistrar
    public static void attachWebServer(Context context, WebHandlerManager manager) {
        try {
            RobotLog.ii(TAG, "Attaching /logger handlers");

            // Static UI
            manager.register("/logger",
                    new StaticAssetHandler(context, "web/index.html", "text/html; charset=utf-8"));
            manager.register("/logger/",
                    new StaticAssetHandler(context, "web/index.html", "text/html; charset=utf-8"));
            manager.register("/logger/index.html",
                    new StaticAssetHandler(context, "web/index.html", "text/html; charset=utf-8"));
            manager.register("/logger/style.css",
                    new StaticAssetHandler(context, "web/style.css", "text/css; charset=utf-8"));
            manager.register("/logger/app.js",
                    new StaticAssetHandler(context, "web/app.js", "application/javascript; charset=utf-8"));

            // API
            manager.register("/logger/api/opmodes",
                    new ApiHandler(context, ApiHandler.Route.OPMODES));
            manager.register("/logger/api/runs",
                    new ApiHandler(context, ApiHandler.Route.RUNS));
            manager.register("/logger/api/run",
                    new ApiHandler(context, ApiHandler.Route.RUN_META));
            manager.register("/logger/api/data",
                    new ApiHandler(context, ApiHandler.Route.DATA));
            manager.register("/logger/api/fs",
                    new ApiHandler(context, ApiHandler.Route.FS));
            manager.register("/logger/api/rename",
                    new ApiHandler(context, ApiHandler.Route.RENAME));
            manager.register("/logger/api/delete",
                    new ApiHandler(context, ApiHandler.Route.DELETE));

        } catch (Throwable t) {
            // Never crash RC startup
            RobotLog.ee(TAG, t, "Failed to attach /logger handlers");
        }
    }
}
