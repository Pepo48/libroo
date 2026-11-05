import { getClientTranslator } from './client-message'

export function getScannerErrorMessage(error: Error, textFor = getClientTranslator()): string {
  if (error.name === 'NotAllowedError') {
    return textFor('copy.scannerPermissionDenied', 'Camera permission was denied. Please allow camera access to scan barcodes.')
  }

  if (error.name === 'NotFoundError') {
    return textFor('copy.scannerCameraMissing', 'No camera found on this device.')
  }

  if (error.name === 'NotReadableError') {
    return textFor('copy.scannerCameraInUse', 'Camera is already in use by another application.')
  }

  if (error.name === 'OverconstrainedError') {
    return textFor('copy.scannerCameraUnsuitable', 'Could not find a suitable camera. Try using a different device.')
  }

  return textFor('copy.scannerCameraError', 'A camera error occurred. Please try again or use a different device.')
}
