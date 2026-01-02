package org.firstinspires.ftc.teamcode.logger.demoOpModes;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.util.ElapsedTime;

import org.firstinspires.ftc.teamcode.logger.LogWriter;

/*
This OpMode demonstrates basic usage of the LogWriter class to log data from a single motor.
It sets motor power and logs the motor encoder position and power over 5 seconds.
*/

@TeleOp(name = "Logger Demo One Motor", group = "Logger")
public class LoggerDemoOneMotor extends LinearOpMode {
    private ElapsedTime runtime = new ElapsedTime();
    private LogWriter logger = null;
    private DcMotor armMotor = null;
    private double armPower = 1.0;
    
    @Override
    public void runOpMode() throws InterruptedException {
        armMotor = hardwareMap.get(DcMotor.class, "armMotor");
        logger = new LogWriter(hardwareMap.appContext, getClass().getSimpleName());
        if (!logger.isReady()) {
            telemetry.addLine("Logger failed to start.");
            telemetry.addData("Error", logger.getInitError());
            telemetry.update();
            return;
        }

        waitForStart();
        // start the opMode timer at 0 when the play button is pressed
        runtime.reset(); 

        while (opModeIsActive() && runtime.seconds() < 5.0) {
            
            armMotor.setPower(armPower);
            armPower -= 0.01;
            
            int pos = armMotor.getCurrentPosition();

            // get the current time in milliseconds
            double t = runtime.milliseconds(); 

            // Write one line to the log file.
            // The first argument is the current time
            // The rest of the arguments are key, value pairs
            logger.logMilliseconds(t, "armEncoder", pos, "armPower", armPower);

        }
    }
}
