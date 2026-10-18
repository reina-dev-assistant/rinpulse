# iOS side of the ReplayEncoder Expo module: streams rendered frame images into an H.264 MP4 with AVAssetWriter. EncoderMath.swift is Foundation
# only so EncoderLogicTests can compile it on Linux; CocoaPods compiles *.swift in this directory only, so the test package is excluded.
Pod::Spec.new do |s|
  s.name           = 'ReplayEncoder'
  s.version        = '1.0.0'
  s.summary        = 'Frame-by-frame H.264 MP4 encoder for the JoyoFit workout replay'
  s.description    = 'Expo module: takes PNG, JPEG or WEBP frame files one at a time and writes them to an MP4 through AVAssetWriter.'
  s.license        = 'AGPL-3.0-or-later'
  s.author         = 'JoyoDigitama'
  s.homepage       = 'https://fit.joyorogo.com'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'CoreMedia', 'CoreVideo', 'CoreGraphics', 'ImageIO'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }

  s.source_files  = ['*.swift']
  s.exclude_files = ['EncoderLogicTests/**/*']
end
