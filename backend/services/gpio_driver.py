from typing import Any, Dict


class GpioDriverError(RuntimeError):
    pass


def inspect_gpio_environment() -> Dict[str, Any]:
    try:
        import gpiozero  # type: ignore
        return {
            "available": True,
            "backend": "gpiozero",
            "relay": True,
            "pwm": hasattr(gpiozero, "PWMOutputDevice"),
        }
    except Exception:
        return {
            "available": False,
            "backend": "none",
            "relay": False,
            "pwm": False,
        }


class DryRunGpioDriver:
    name = "dry_run"

    def set_relay(self, actuator: Dict[str, Any], command: str) -> Dict[str, Any]:
        return {
            "driver": self.name,
            "output_id": actuator.get("id"),
            "gpio_pin": actuator.get("gpio_pin", actuator.get("pin")),
            "kind": "relay",
            "command": command,
            "active_level": actuator.get("active_level"),
        }

    def set_pwm(self, actuator: Dict[str, Any], duty_percent: int) -> Dict[str, Any]:
        return {
            "driver": self.name,
            "output_id": actuator.get("id"),
            "gpio_pin": actuator.get("gpio_pin", actuator.get("pin")),
            "kind": "pwm",
            "duty_percent": duty_percent,
            "frequency": actuator.get("pwm_frequency", 1000),
        }


class RealGpioDriver:
    def __init__(self) -> None:
        try:
            import gpiozero  # type: ignore
        except Exception as exc:
            raise GpioDriverError("No GPIO backend is available in the current Python environment") from exc
        self._gpiozero = gpiozero
        self.name = "gpiozero"

    def set_relay(self, actuator: Dict[str, Any], command: str) -> Dict[str, Any]:
        pin = int(actuator["gpio_pin"])
        active_high = actuator.get("active_level") == "high"
        device = self._gpiozero.OutputDevice(pin, active_high=active_high, initial_value=False)
        try:
            if command == "on":
                device.on()
            elif command == "off":
                device.off()
            else:
                raise GpioDriverError(f"Unsupported relay command: {command}")
        finally:
            device.close()

        return {
            "driver": self.name,
            "output_id": actuator.get("id"),
            "gpio_pin": pin,
            "kind": "relay",
            "command": command,
            "active_level": actuator.get("active_level"),
        }

    def set_pwm(self, actuator: Dict[str, Any], duty_percent: int) -> Dict[str, Any]:
        if not hasattr(self._gpiozero, "PWMOutputDevice"):
            raise GpioDriverError("PWMOutputDevice is not available in the current GPIO backend")

        pin = int(actuator["gpio_pin"])
        frequency = int(actuator.get("pwm_frequency", 1000))
        value = max(0.0, min(1.0, float(duty_percent) / 100.0))
        device = self._gpiozero.PWMOutputDevice(pin, frequency=frequency, initial_value=0)
        try:
            device.value = value
        finally:
            device.close()

        return {
            "driver": self.name,
            "output_id": actuator.get("id"),
            "gpio_pin": pin,
            "kind": "pwm",
            "duty_percent": duty_percent,
            "frequency": frequency,
        }


def get_gpio_driver(dry_run: bool):
    if dry_run:
        return DryRunGpioDriver()
    return RealGpioDriver()
