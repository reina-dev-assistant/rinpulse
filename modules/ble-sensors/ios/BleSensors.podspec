# iOS side of the BleSensors Expo module: external sports sensors (BLE heart-rate straps, cycling and running sensors) and the phone-side GPS of a
# phone-recorded workout. SensorProfile.swift is Foundation only so SensorLogicTests can compile it on Linux; CocoaPods compiles *.swift in this
# directory only, so the test package is excluded.
Pod::Spec.new do |s|
  s.name           = 'BleSensors'
  s.version        = '1.0.0'
  s.summary        = 'External Bluetooth LE sports sensors and workout GPS for JoyoFit'
  s.description    = 'Expo module: a thin CoreBluetooth GATT transport for heart rate, cycling speed/cadence, cycling power and running speed/cadence sensors, plus CoreLocation fixes for phone-recorded workouts.'
  s.license        = 'AGPL-3.0-or-later'
  s.author         = 'JoyoDigitama'
  s.homepage       = 'https://fit.joyorogo.com'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreBluetooth', 'CoreLocation'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }

  s.source_files  = ['*.swift']
  s.exclude_files = ['SensorLogicTests/**/*']
end
