package org.firstinspires.ftc.teamcode.logger.demoOpModes;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.util.ElapsedTime;

import org.firstinspires.ftc.teamcode.logger.LogWriter;

/*
This OpMode demonstrates basic usage of the LogWriter class to log data to a JSON Lines file.
It logs two example variables (x and y) over a period of 10 seconds, simulating noisy measurements.
*/

@TeleOp(name = "Logger Demo No Hardware", group = "Logger")
public class LoggerDemoNoHardware extends LinearOpMode {
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

        while (opModeIsActive() && runtime.seconds() < 10.0) {
            double t = runtime.milliseconds();
            double x = 500.0 + 20.0 * randomGaussian(); // noisy steady
            double y = 0.5 * t + 1.0 + 40.0 * randomGaussian(); // noisy linear

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
