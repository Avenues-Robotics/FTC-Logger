package org.firstinspires.ftc.teamcode.logger.demoOpModes;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.util.ElapsedTime;

import org.firstinspires.ftc.teamcode.logger.java.Configurable;
import org.firstinspires.ftc.teamcode.logger.java.LoggerTelemetry;

/*
This OpMode demonstrates LoggerTelemetry: one object for Driver Station telemetry AND the logger graph.
It graphs two example variables (x and y) over a period of 10 seconds, simulating noisy measurements.

  telemetry.addData(...)   shows a value on the Driver Station, as usual
  telemetry.addGraph(...)  adds values to the logger graph (name, value, name, value, ...)
  telemetry.update()       sends the telemetry and writes one graph row (time is added for you)

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

    ElapsedTime runtime = new ElapsedTime();

    @Override
    public void runOpMode() throws InterruptedException {
        // Replaces the OpMode's telemetry for this method: same calls, plus addGraph().
        LoggerTelemetry telemetry = new LoggerTelemetry(this);

        telemetry.addLine("Logger Demo ready. Press START.");
        telemetry.update();

        waitForStart();
        runtime.reset();

        while (opModeIsActive() && runtime.seconds() < runSeconds) {
            double t = runtime.seconds();
            double x = xMean + noise * randomGaussian(); // noisy steady
            double y = slope * t + 1.0 + 2.0 * noise * randomGaussian(); // noisy linear

            telemetry.addData("t", "%.2f", t);
            telemetry.addData("x", "%.2f", x);
            telemetry.addData("y", "%.2f", y);
            telemetry.addGraph("x", x, "y", y);
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
