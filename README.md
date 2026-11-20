# FTC Logger

FTC Logger allows you to write logs from within an OpMode to JSONL files on the Robot Controller and provides a built-in web UI to explore plots, statistics, and run data.

![FTC Logger preview](logger-preview.png)

## What it does
- Writes run logs as JSONL files under:
  `.../ftc-logger/<OpMode>/<RunNumber>.jsonl`
- Exposes a lightweight HTTP API on the RC web server at `/logger/api/*`
- Serves a web UI at `/logger` for plotting and inspecting runs
- Lets you view and edit `public static` variables of `@Configurable` classes live from the web UI
- Lets you INIT / start / stop OpModes from the browser, with live telemetry and a live plot of the running OpMode's log

## How to add to your Robot Controller
1) **[Download logger.zip](https://github.com/Avenues-Robotics/ftc-logger/releases/latest/download/logger.zip)** and unzip it. You'll get a folder named `logger`.
   (Don't use GitHub's green "Code → Download ZIP" button: that folder is named `ftc-logger-main` and won't compile until you rename it.)
2) Drag the `logger` folder into `TeamCode/src/main/java/org/firstinspires/ftc/teamcode/` (in Android Studio, that's the `teamcode` package). `dev-tools` and `demoOpModes` are optional and can be deleted. That's all: no Gradle or other setup is needed.
3) Follow the instructions below to use it in an OpMode

## How to use in an OpMode
Graph from the same object you already use for telemetry:

1) Create a `LoggerTelemetry`: `LoggerTelemetry telemetry = new LoggerTelemetry(this);`
2) Each loop, add values to the graph: `telemetry.addGraph("test encoder", pos, "test power", testPower);`
3) Call `telemetry.update()` as usual. It sends telemetry to the Driver Station **and** writes one graph row. Time (in seconds) is added for you.

`LoggerTelemetry` is regular telemetry plus `addGraph`. Regular telemetry calls like `addData`, `addLine`, `log()`, etc. are unaffected.

### Example OpMode
This assumes you have a motor and encoder plugged into your Robot Controller and named `testMotor` in your configuration. It's the same as `demoOpModes/LoggerDemoOneMotor.java`.

```java
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.util.ElapsedTime;

import org.firstinspires.ftc.teamcode.logger.java.LoggerTelemetry;

@TeleOp(name = "Sample Logger Op Mode", group = "Logger")
public class SampleLoggerOpMode extends LinearOpMode {
    private ElapsedTime runtime = new ElapsedTime();
    private DcMotor testMotor = null;
    private double testPower = 1.0;

    @Override
    public void runOpMode() throws InterruptedException {
        testMotor = hardwareMap.get(DcMotor.class, "testMotor");

        // Replaces the OpMode's telemetry for this method: same calls, plus addGraph().
        LoggerTelemetry telemetry = new LoggerTelemetry(this);

        waitForStart();
        runtime.reset();

        while (opModeIsActive() && runtime.seconds() < 5.0) {
            testMotor.setPower(testPower);
            testPower -= 0.01;

            int pos = testMotor.getCurrentPosition();

            telemetry.addData("Motor encoder", pos);                            // Driver Station
            telemetry.addGraph("test encoder", pos, "test power", testPower);   // graph: name, value pairs
            telemetry.update();                                                 // sends both
        }
    }
}
```

### Details
- `addGraph` can be called several times before `update()`; all values go into the same row. Reusing a name replaces its value.
- Graph time starts at 0 on the first row. `resetGraphTime()` restarts it (for example, right after `waitForStart()` if you graphed during INIT).
- The log file is created on the first graph row (OpModes that never graph don't leave empty runs) and closed automatically when the OpMode stops.
- If the log file can't be created, a message is added to the Driver Station telemetry log and the OpMode keeps running.
- To also send telemetry to FTC Dashboard, wrap it: `new LoggerTelemetry(new MultipleTelemetry(telemetry, dashboard.getTelemetry()), hardwareMap.appContext, "MyOpMode")`.

### Advanced: writing logs directly with `LogWriter`
`LoggerTelemetry` writes through `LogWriter`. Use `LogWriter` yourself if you need to control the timestamps (your own clock, or milliseconds/nanoseconds), or log without telemetry:

```java
import org.firstinspires.ftc.teamcode.logger.java.LogWriter;

LogWriter logger = new LogWriter(hardwareMap.appContext, getClass().getSimpleName());
if (!logger.isReady()) {
    telemetry.addData("Logger failed to start", logger.getInitError());
}
// ...each loop: time first, then name, value pairs
logger.logMilliseconds(runtime.milliseconds(), "test encoder", pos, "test power", testPower);
// ...when done
logger.close();
```

## Configurable variables
Mark any class in TeamCode with `@Configurable` and its `public static` (non-final) fields show up in the **Configurable** panel. Values can be edited from the browser while the robot is running.

```java
import org.firstinspires.ftc.teamcode.logger.java.Configurable;

@Configurable
@TeleOp(name = "Arm Tuner")
public class ArmTuner extends LinearOpMode {
    public static double kP = 0.01;
    public static int targetPosition = 500;
    public static boolean useFeedforward = true;
    // ...
}
```

- The class that matches the currently selected OpMode (by class name, the same name used for its log folder) is listed first and expanded; other classes are collapsed. Nested classes (e.g. `ArmTuner.Params`) are grouped with their outer OpMode.
- Supported types: `int`, `long`, `short`, `byte`, `double`, `float`, `boolean` (and boxed versions), `String`, and enums. `final` fields and other types are not shown.
- Type a value and press Enter (or click away) to send it. A green border means it was applied; red means it was rejected (hover for the reason). Esc reverts.
- Changes take effect the next time your code reads the field, so read the field inside your loop for live tuning. Values are not saved: they reset to the defaults in your code when the Robot Controller app restarts.
- Click ↺ next to a value to reset it to the value in your code. It only appears when the value has been changed.
- The panel reloads the current values automatically when an OpMode is initialized or stops, and when the robot reconnects (for example after installing a new build, so new `@Configurable` classes show up).
- Classes are found by scanning the installed TeamCode APK, so this works for code built with Android Studio (not OnBot Java).

## Viewing logs
- Connect to the Robot Controller WiFi, then open a browser to `http://192.168.43.1:8080/logger`
- The UI allows you to select an OpMode and choose from multiple runs.
- The Log Manager allows you to rename or delete log files.

## Running OpModes from the web UI
The **Robot** panel in the top left works like the Driver Station:
- Pick an OpMode (Autonomous and TeleOp are grouped), then press **INIT**.
- While initialized, **▶** (start) and **■** (stop) appear side by side.
- While running, only **■** is shown.
- Press **Space** at any time while an OpMode is initialized or running to stop it (e-stop). It works wherever the keyboard focus is.

The panel follows changes made from the Driver Station as well.

### Live plot
While an OpMode is initialized or running, the plot follows the log file it is writing and updates about four times a second. The **Live** button in the plot toolbar turns this on or off; its dot pulses red while following.
- The time axis starts as a 30-second window and auto-scales once the run goes past 30 s.
- Zoom or pan to freeze the view; press **Extents** to resume auto-scaling.
- The OpMode and Run pickers are greyed out while an OpMode is initialized or running; stop it to pick a different log.
- When the run ends, the last rows are fetched and the stats and table are refreshed.

The OpMode's log is found automatically: it is the newest `.jsonl` file written since INIT, in any OpMode folder.

### Telemetry
The Telemetry panel shows exactly what the Driver Station shows for the current OpMode: `addData` items, `addLine` lines, `Func` values, number formatting, separators, and the `telemetry.log()` lines (below the dashed divider). After the OpMode stops, its last telemetry stays visible, dimmed.

Telemetry is read from the SDK's own telemetry object, so it works without any changes to your OpMode, including when you wrap `telemetry` (for example with FTC Dashboard's `MultipleTelemetry`). HTML-formatted telemetry (`DisplayFormat.HTML`) is detected from the content and rendered with a safe subset of tags.

> Safety: the robot will move when you press ▶. Keep a Driver Station connected so you can stop it, because the Driver Station's emergency stop still applies.


## Dev tools
The `dev-tools` folder contains a lightweight local server, a fake robot, and a sample log file so you can iterate on the UI without deploying to a Robot Controller.

- Location: `TeamCode/src/main/java/org/firstinspires/ftc/teamcode/logger/dev-tools`
- UI assets: `TeamCode/src/main/java/org/firstinspires/ftc/teamcode/logger/web`
- `logger-dev-server.py`: serves the local UI and can proxy the API or serve fake data
- `build-web-assets.py`: compiles `web/*` into `java/WebAssets.java` (see below)
- `0001.jsonl`: sample log file used by the dev server

### Editing the web UI
The robot serves the web UI from `java/WebAssets.java`, a generated file that contains `web/index.html`, `web/style.css` and `web/app.js`. That's what lets teams install the logger by copying one folder, with no Gradle changes. Don't edit `WebAssets.java` by hand: edit the files in `web/`, then regenerate it before building for the robot or committing:

```bash
python3 TeamCode/src/main/java/org/firstinspires/ftc/teamcode/logger/dev-tools/build-web-assets.py
```

The dev server always serves `web/` directly, and prints a warning in its terminal when `WebAssets.java` is out of date. `build-web-assets.py --check` exits with an error when it's out of date (useful in CI or a pre-commit hook).

### Run with fake data
```bash
python3 TeamCode/src/main/java/org/firstinspires/ftc/teamcode/logger/dev-tools/logger-dev-server.py --fake
```
Then open `http://127.0.0.1:8000/`.

If you are running from this folder on its own (not inside TeamCode), point `--root` at the `web` folder:
```bash
python3 dev-tools/logger-dev-server.py --fake --root web
```

### Fake robot
With `--fake`, the **Robot** panel drives a simulated robot:

| OpMode | Type | Behavior |
| --- | --- | --- |
| Auto Example | Autonomous | Arm simulation; ends on its own after 5 s |
| Arm PID Test | TeleOp | Arm simulation; runs until stopped |
| Logger Demo No Hardware | TeleOp | Noisy `x`/`y` data like the demo OpMode; ends after 10 s |

The fake OpModes also send telemetry (status, arm position, power, gains, and log lines), so the Telemetry panel and live plot can be tried without a robot.

- INIT takes a moment to apply, as on a real robot.
- Each INIT creates a new run file (`0002.jsonl`, `0003.jsonl`, ...) under the `DEV_TEST` OpMode, and START fills it. The plot follows it live.
- The arm simulation reads the fake Configurable values every tick: `ArmConstants.kP`, `kD` and `maxPower`, plus `DEV_TEST.targetPosition` and `mode` (`IDLE` cuts power). Change them in the Configurable panel and the next run, or the current one, reflects it.
- New runs are written next to the script by default. Use `--fake-dir PATH` to keep them somewhere else, or delete them from **Manage Log Files**.

### Run while connected to the Robot Controller WiFi
```bash
python3 TeamCode/src/main/java/org/firstinspires/ftc/teamcode/logger/dev-tools/logger-dev-server.py
```
Then open `http://127.0.0.1:8000/`. API calls are proxied to `http://192.168.43.1:8080`; pass `--robot URL` to use a different address.

## License
MIT License. See the repository `LICENSE` file for details.
