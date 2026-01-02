# FTC Logger

FTC Logger allows you to write logs from within an OpMode to JSONL files on the Robot Controller and provides a built-in web UI to explore plots, statistics, and run data.

## What it does
- Writes run logs as JSONL files under:
  `.../ftc-logger/<OpMode>/<RunNumber>.jsonl`
- Exposes a lightweight HTTP API on the RC web server at `/logger/api/*`
- Serves a web UI at `/logger` for plotting and inspecting runs

## How to use in an OpMode
1) Create a `LogWriter` and log numeric fields each loop.
2) Pick a time unit (seconds, milliseconds, or nanoseconds) and stick to it.
3) Close the logger when finished.

### Example OpMode
This assumes you have a motor and encoder plugged into your Robot Controller and named `armMotor` in your configuration.

```java
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.util.ElapsedTime;

import org.firstinspires.ftc.teamcode.logger.LogWriter;


@TeleOp(name = "Sample Logger Op Mode", group = "Logger")
public class SampleLoggerOpMode extends LinearOpMode {
    private ElapsedTime runtime = new ElapsedTime();
    private LogWriter logger = null;
    private DcMotor armMotor = null;
    private double armPower = 1.0;
    
    @Override
    public void runOpMode() throws InterruptedException {
        armMotor = hardwareMap.get(DcMotor.class, "armMotor");
        logger = new LogWriter(hardwareMap.appContext, getClass().getSimpleName());
        
        // Optional check to make sure file can be written 
        if (!logger.isReady()) {
            telemetry.addLine("Logger failed to start.");
            telemetry.addData("Error", logger.getInitError());
            telemetry.update();
            return;
        }

        waitForStart();
        runtime.reset(); // start the opMode timer at 0

        while (opModeIsActive()) {
            
            armMotor.setPower(armPower);
            armPower -= 0.01;
            
            int pos = armMotor.getCurrentPosition();

            //get the current time in milliseconds
            double t = runtime.milliseconds(); 

            // Write one line to the log file.
            // The first argument is the current time
            // The rest of the arguments are key, value pairs
            logger.logMilliseconds(t, "armEncoder", pos, "armPower", armPower);

        }
    }
}
```

## Viewing logs
- On the RC: open a browser to `http://192.168.43.1:8080/logger`
- The UI shows runs per OpMode and plots selected series
- Time units are taken from the log file header (`tUnit`)

## API summary
- `GET /logger/api/opmodes`
- `GET /logger/api/runs?opMode=NAME`
- `GET /logger/api/data?opMode=NAME&run=RUN`

## Dev tools
The `dev-tools` folder contains a lightweight local server and a fake log file so you can iterate on the UI without deploying to a Robot Controller.

- Location: `TeamCode/src/main/java/org/firstinspires/ftc/teamcode/logger/dev-tools`
- `logger-dev-server.py`: serves the local UI and can proxy the API or serve fake data
- `fake-log.jsonl`: sample log file used by the dev server

### Run with fake data
```bash
python3 TeamCode/src/main/java/org/firstinspires/ftc/teamcode/logger/dev-tools/logger-dev-server.py --fake
```
Then open `http://127.0.0.1:8000/`.

### Run while connected to the Robot Controller WiFi
```bash
python3 TeamCode/src/main/java/org/firstinspires/ftc/teamcode/logger/dev-tools/logger-dev-server.py --robot http://192.168.43.1:8080
```


## License
MIT License. See the repository `LICENSE` file for details.
