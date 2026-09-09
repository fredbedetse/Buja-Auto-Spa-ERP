// Device ID management - unique per browser/device
import { v4 as uuidv4 } from 'uuid';

const DEVICE_ID_KEY = 'buja_device_id';
const DEVICE_INFO_KEY = 'buja_device_info';

export function getDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = uuidv4();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

export function getDeviceInfo(): string {
  let info = localStorage.getItem(DEVICE_INFO_KEY);
  if (!info) {
    const deviceInfo = {
      userAgent: navigator.userAgent,
      platform: (navigator as any).userAgentData?.platform || navigator.platform,
      language: navigator.language,
      screen: `${window.screen.width}x${window.screen.height}`,
      timestamp: new Date().toISOString(),
    };
    info = JSON.stringify(deviceInfo);
    localStorage.setItem(DEVICE_INFO_KEY, info);
  }
  return info;
}

export function getDeviceIdAndInfo() {
  return {
    deviceId: getDeviceId(),
    deviceInfo: getDeviceInfo(),
  };
}
