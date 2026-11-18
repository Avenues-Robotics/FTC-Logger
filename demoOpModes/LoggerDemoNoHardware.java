package org.firstinspires.ftc.teamcode.logger.demoOpModes;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.util.ElapsedTime;

import org.firstinspires.ftc.teamcode.logger.java.Configurable;
import org.firstinspires.ftc.teamcode.logger.java.LogWriter;

/*
This OpMode demonstrates basic usage of the LogWriter class to log data to a JSON Lines file.
It logs two example variables (x and y) over a period of 10 seconds, simulating noisy measurements.

Because the class is marked @Configurable, its public static fields appear in the
"Configurable" panel of the logger dashboard and can be changed between (or during) runs.
*/

@Configurable
@TeleOp(name = "Logger Demo No Hardware", group = "Logger")
public class LoggerDemoNoHardware extends LinearOpMode {
    // Editable from the dashboard
    public static double runSeconds = 10.0;
    public static double xMean = 500.0;
    public static double noise = 20.0;
    public static double slope = 0.5;

    LogWriter logger = null;
    ElapsedTime runtime = new ElapsedTime();

    @Override
    public void runOpMode() throws InterruptedException {
        
        logger = new LogWriter(hardwareMap.appContext, getClass().getSimpleName());
        if (!logger.isReady()) {
            telemetry.addLine("Logger failed to start.");
            telemetry.addData("Error", logger.getInitError());
            telemetry.update();
            return;
        }
        telemetry.addLine("Logger Demo ready. Press START.");
        telemetry.update();

        waitForStart();
        runtime.reset();

        while (opModeIsActive() && runtime.seconds() < runSeconds) {
            double t = runtime.milliseconds();
            double x = xMean + noise * randomGaussian(); // noisy steady
            double y = slope * t + 1.0 + 2.0 * noise * randomGaussian(); // noisy linear

            logger.logMilliseconds(t, "x", x, "y", y);

            telemetry.addData("t", "%.2f", t);
            telemetry.addData("x", "%.2f", x);
            telemetry.addData("y", "%.2f", y);
            telemetry.update();

            sleep(10);
        }

    }

    private double randomGaussian() {
        // Box-Muller transform
        double u1 = Math.random();
        double u2 = Math.random();
        return Math.sqrt(-2.0 * Math.log(Math.max(u1, 1e-9))) * Math.cos(2.0 * Math.PI * u2);
    }
}
