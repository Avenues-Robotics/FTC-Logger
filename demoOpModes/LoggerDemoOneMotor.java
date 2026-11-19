package org.firstinspires.ftc.teamcode.logger.demoOpModes;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.util.ElapsedTime;

import org.firstinspires.ftc.teamcode.logger.java.Configurable;
import org.firstinspires.ftc.teamcode.logger.java.LoggerTelemetry;

/*
This OpMode demonstrates graphing a single motor with LoggerTelemetry.
It ramps the motor power down from 1.0 and graphs the encoder position and power for 5 seconds.

LoggerTelemetry is regular telemetry plus one extra method:
  telemetry.addData(...)   shows a value on the Driver Station, as usual
  telemetry.addGraph(...)  adds values to the logger graph (name, value, name, value, ...)
  telemetry.update()       sends the telemetry and writes one graph row (time is added for you)
*/

@Configurable
@TeleOp(name = "Logger Demo One Motor", group = "Logger")
public class LoggerDemoOneMotor extends LinearOpMode {
    private ElapsedTime runtime = new ElapsedTime();
    private DcMotor testMotor = null;
    public static double testMotorPower = 1.0;

    @Override
    public void runOpMode() throws InterruptedException {
        testMotor = hardwareMap.get(DcMotor.class, "testMotor");

        // Replaces the OpMode's telemetry for this method: same calls, plus addGraph().
        LoggerTelemetry telemetry = new LoggerTelemetry(this);

        telemetry.addLine("Ready. Press START to run the arm for 5 seconds.");
        telemetry.update();

        waitForStart();
        // start the OpMode timer at 0 when the play button is pressed
        runtime.reset();

        while (opModeIsActive()) {

            testMotor.setPower(testMotorPower);

            int pos = testMotor.getCurrentPosition();

            // Driver Station
            telemetry.addData("Arm encoder", pos);
            telemetry.addData("Arm power", "%.2f", testMotorPower);

            // Graph: name, value pairs
            telemetry.addGraph("armEncoder", pos, "armPower", testMotorPower);

            // Sends the telemetry and writes one row to the graph
            telemetry.update();
        }
    }
}
