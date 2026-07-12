import atexit
import signal
import threading
from typing import Any, Dict, Iterable, List, Optional


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

    def apply_safe_state(self, actuator: Dict[str, Any]) -> Dict[str, Any]:
        if (actuator.get("kind") or actuator.get("type")) == "pwm":
            return self.set_pwm(actuator, int(actuator.get("safe_duty", 0)))
        return self.set_relay(actuator, str(actuator.get("safe_state") or "off"))

    def shutdown_all(self, actuators: Iterable[Dict[str, Any]], close: bool = False) -> List[Dict[str, Any]]:
        return [self.apply_safe_state(actuator) for actuator in actuators]


class RealGpioDriver:
    def __init__(self) -> None:
        try:
            import gpiozero  # type: ignore
        except Exception as exc:
            raise GpioDriverError("No GPIO backend is available in the current Python environment") from exc
        self._gpiozero = gpiozero
        self.name = "gpiozero"
        self._lock = threading.RLock()
        self._devices: Dict[str, Any] = {}
        self._actuators: Dict[str, Dict[str, Any]] = {}

    def _key(self, actuator: Dict[str, Any]) -> str:
        output_id = str(actuator.get("id") or "").strip()
        if output_id:
            return output_id
        kind = actuator.get("kind") or actuator.get("type") or "relay"
        pin = actuator.get("gpio_pin", actuator.get("pin"))
        return f"{kind}:{pin}"

    def _relay_initial_value(self, actuator: Dict[str, Any]) -> bool:
        return str(actuator.get("safe_state") or "off") == "on"

    def _get_relay_device(self, actuator: Dict[str, Any]) -> Any:
        key = self._key(actuator)
        device = self._devices.get(key)
        if device is not None:
            return device

        pin = int(actuator["gpio_pin"])
        active_high = str(actuator.get("active_level") or "low") == "high"
        device = self._gpiozero.OutputDevice(
            pin,
            active_high=active_high,
            initial_value=self._relay_initial_value(actuator),
        )
        self._devices[key] = device
        self._actuators[key] = dict(actuator)
        return device

    def _get_pwm_device(self, actuator: Dict[str, Any]) -> Any:
        if not hasattr(self._gpiozero, "PWMOutputDevice"):
            raise GpioDriverError("PWMOutputDevice is not available in the current GPIO backend")

        key = self._key(actuator)
        device = self._devices.get(key)
        if device is not None:
            return device

        pin = int(actuator["gpio_pin"])
        frequency = int(actuator.get("pwm_frequency", 1000))
        device = self._gpiozero.PWMOutputDevice(pin, frequency=frequency, initial_value=0)
        self._devices[key] = device
        self._actuators[key] = dict(actuator)
        return device

    def set_relay(self, actuator: Dict[str, Any], command: str) -> Dict[str, Any]:
        with self._lock:
            pin = int(actuator["gpio_pin"])
            device = self._get_relay_device(actuator)
            if command == "on":
                device.on()
            elif command == "off":
                device.off()
            else:
                raise GpioDriverError(f"Unsupported relay command: {command}")

            return {
                "driver": self.name,
                "output_id": actuator.get("id"),
                "gpio_pin": pin,
                "kind": "relay",
                "command": command,
                "active_level": actuator.get("active_level"),
            }

    def set_pwm(self, actuator: Dict[str, Any], duty_percent: int) -> Dict[str, Any]:
        with self._lock:
            pin = int(actuator["gpio_pin"])
            frequency = int(actuator.get("pwm_frequency", 1000))
            value = max(0.0, min(1.0, float(duty_percent) / 100.0))
            device = self._get_pwm_device(actuator)
            device.value = value

            return {
                "driver": self.name,
                "output_id": actuator.get("id"),
                "gpio_pin": pin,
                "kind": "pwm",
                "duty_percent": duty_percent,
                "frequency": frequency,
            }

    def apply_safe_state(self, actuator: Dict[str, Any]) -> Dict[str, Any]:
        kind = actuator.get("kind") or actuator.get("type") or "relay"
        if kind == "pwm":
            return self.set_pwm(actuator, int(actuator.get("safe_duty", 0)))
        return self.set_relay(actuator, str(actuator.get("safe_state") or "off"))

    def close_actuator(self, actuator: Dict[str, Any], apply_safe: bool = True) -> Optional[Dict[str, Any]]:
        result: Optional[Dict[str, Any]] = None
        with self._lock:
            if apply_safe:
                result = self.apply_safe_state(actuator)
            device = self._devices.pop(self._key(actuator), None)
            self._actuators.pop(self._key(actuator), None)
            if device is not None:
                device.close()
        return result

    def shutdown_all(self, actuators: Iterable[Dict[str, Any]], close: bool = False) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        with self._lock:
            actuator_list = list(actuators) or list(self._actuators.values())
            for actuator in actuator_list:
                try:
                    results.append(self.apply_safe_state(actuator))
                except Exception as exc:
                    results.append({
                        "driver": self.name,
                        "output_id": actuator.get("id"),
                        "gpio_pin": actuator.get("gpio_pin", actuator.get("pin")),
                        "error": str(exc),
                    })
            if close:
                for key, device in list(self._devices.items()):
                    try:
                        device.close()
                    finally:
                        self._devices.pop(key, None)
                        self._actuators.pop(key, None)
        return results


_real_driver: Optional[RealGpioDriver] = None
_real_driver_lock = threading.Lock()


def get_real_gpio_driver() -> RealGpioDriver:
    global _real_driver
    with _real_driver_lock:
        if _real_driver is None:
            _real_driver = RealGpioDriver()
        return _real_driver


def get_gpio_driver(dry_run: bool):
    if dry_run:
        return DryRunGpioDriver()
    return get_real_gpio_driver()


def _shutdown_real_driver_at_exit() -> None:
    driver = _real_driver
    if driver is None:
        return
    try:
        driver.shutdown_all([], close=True)
    except Exception:
        pass


def _shutdown_real_driver_on_signal(signum, frame) -> None:
    _shutdown_real_driver_at_exit()
    raise SystemExit(128 + int(signum))


atexit.register(_shutdown_real_driver_at_exit)

for _sig in (getattr(signal, "SIGTERM", None), getattr(signal, "SIGINT", None)):
    if _sig is None:
        continue
    try:
        signal.signal(_sig, _shutdown_real_driver_on_signal)
    except Exception:
        pass
