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

            // Static UI (compiled in from web/* as WebAssets.java)
            manager.register("/logger",
                    new StaticAssetHandler("index.html", "text/html; charset=utf-8"));
            manager.register("/logger/",
                    new StaticAssetHandler("index.html", "text/html; charset=utf-8"));
            manager.register("/logger/index.html",
                    new StaticAssetHandler("index.html", "text/html; charset=utf-8"));
            manager.register("/logger/style.css",
                    new StaticAssetHandler("style.css", "text/css; charset=utf-8"));
            manager.register("/logger/app.js",
                    new StaticAssetHandler("app.js", "application/javascript; charset=utf-8"));
            manager.register("/logger/logo.png",
                    new StaticAssetHandler("logo.png", "image/png"));

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
            manager.register("/logger/api/config",
                    new ApiHandler(context, ApiHandler.Route.CONFIG));
            manager.register("/logger/api/setconfig",
                    new ApiHandler(context, ApiHandler.Route.SET_CONFIG));

            // OpMode control (Driver Station-style init / start / stop)
            manager.register("/logger/api/control/opmodes",
                    new ApiHandler(context, ApiHandler.Route.CONTROL_OPMODES));
            manager.register("/logger/api/control/state",
                    new ApiHandler(context, ApiHandler.Route.CONTROL_STATE));
            manager.register("/logger/api/control/init",
                    new ApiHandler(context, ApiHandler.Route.CONTROL_INIT));
            manager.register("/logger/api/control/start",
                    new ApiHandler(context, ApiHandler.Route.CONTROL_START));
            manager.register("/logger/api/control/stop",
                    new ApiHandler(context, ApiHandler.Route.CONTROL_STOP));

        } catch (Throwable t) {
            // Never crash RC startup
            RobotLog.ee(TAG, t, "Failed to attach /logger handlers");
        }
    }
}
