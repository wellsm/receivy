export function httpFailure(status: number): 'transient' | 'permanent' {
  return status === 429 || status >= 500 ? 'transient' : 'permanent';
}

export function expoError(error?: string): 'device_unregistered' | 'transient' | 'permanent' {
  if (error === 'DeviceNotRegistered') {
    return 'device_unregistered';
  }

  if (error === 'MessageRateExceeded') {
    return 'transient';
  }

  return 'permanent';
}
