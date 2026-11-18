package org.firstinspires.ftc.teamcode.logger.java;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a TeamCode class whose {@code public static} (non-final) fields should be
 * shown and edited live in the FTC Logger dashboard (http://192.168.43.1:8080/logger).
 *
 * Example:
 * <pre>
 * &#64;Configurable
 * &#64;TeleOp(name = "Arm Tuner")
 * public class ArmTuner extends LinearOpMode {
 *     public static double kP = 0.01;
 *     public static int targetPosition = 500;
 *     public static boolean useFeedforward = true;
 *     ...
 * }
 * </pre>
 *
 * Supported field types: int, long, short, byte, double, float, boolean (and their
 * boxed versions), String, and enums. Other types and {@code final} fields are ignored.
 *
 * Values changed in the dashboard take effect the next time your code reads the field,
 * so read them inside your loop (not once before waitForStart) if you want live tuning.
 * Changes live in memory only and reset when the Robot Controller app restarts.
 *
 * Any annotation whose simple name is "Configurable" is recognized, so classes already
 * annotated for Panels (com.bylazar...Configurable) also appear, provided that annotation
 * is retained at runtime.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface Configurable { }
