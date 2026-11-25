# SpinMap iOS — Xcode & App Store Connect Submission Guide

This folder contains a **100% native SwiftUI + Apple MapKit** iOS application (`iOS 17.0+`, iPhone & iPad) with zero third-party SDK dependencies, offline-bundled Melbourne & Sydney OSM bikeway routes, a 1024×1024 opaque App Store icon, and Apple's mandatory `PrivacyInfo.xcprivacy` manifest.

---

## 1. Clone on Your Mac & Open in Xcode

1. Clone this repository on your Mac:
   ```bash
   git clone https://github.com/verse404/SpinMap.git
   open SpinMap/ios/SpinMap.xcodeproj
   ```
2. Open **`SpinMap.xcodeproj`** in **Xcode 15 or Xcode 16+**.
3. Select the **`SpinMap`** project in the left navigator → **`SpinMap` target** → **Signing & Capabilities**:
   - Check **Automatically manage signing**.
   - Choose your **Apple Developer Team** (enrolled in the Apple Developer Program, \$99/year for App Store distribution).
   - Change **Bundle Identifier** from `com.spinmap.cycling` to your own unique reverse-DNS ID (e.g. `com.<yourname>.spinmap`).

---

## 2. Run & Test Locally on Simulator or iPhone

- **Run App (`⌘R`)**: Select any iPhone Simulator (e.g. *iPhone 16 Pro*) or your plugged-in iPhone and press **`⌘R`**.
  - In Simulator, test GPS routing via **Features → Location → Custom Location** (e.g. Melbourne `-37.8482, 144.9672` or Sydney `-33.8688, 151.2093`).
- **Run Unit Tests (`⌘U`)**: Executes `SpinMapTests` covering bike pace math, headwind/tailwind shading, route reversal, XML-safe GPX export, and waypoint insertion.

---

## 3. Archive & Upload to App Store Connect / TestFlight

1. In the Xcode destination bar at the top, select **Any iOS Device (arm64)**.
2. Choose **Product → Archive** from the menu bar.
3. When Xcode Organizer opens, click **Distribute App → App Store Connect → Upload**.
4. Wait ~5–15 minutes for Apple's automated processing (your `PrivacyInfo.xcprivacy`, `ITSAppUsesNonExemptEncryption = NO`, and opaque 1024×1024 `AppIcon.png` are pre-configured so standard ITMS checks pass automatically).
5. In [App Store Connect](https://appstoreconnect.apple.com):
   - Create a new iOS app matching your Bundle Identifier (`SpinMap`).
   - Test on real iPhones immediately via **TestFlight** before public submission.

---

## 4. App Store Listing & Review Answers (Ready to Paste)

- **Category**: Health & Fitness (Secondary: Navigation)
- **App Privacy (Nutrition Label)**:
  - **Location → Precise Location**: Checked → **App Functionality only** → **Not linked to user identity** → **Not used for tracking**.
  - All other data types: **No data collected**.
- **Export Compliance**: Already pre-declared (`ITSAppUsesNonExemptEncryption = NO` in `Info.plist`).
- **Screenshots Needed**: Capture directly from Simulator (`⌘S` on *iPhone 16 Pro Max* 6.9" and *iPhone 16* 6.1"):
  1. Explore Map showing Melbourne coastal route + Wind shading overlay (`🍃 Wind`).
  2. Elevation Scrubber + Bike Type Pace Selector (`🚲 / ⚡ / 🚴 / 🌲`).
  3. Weather Ride Window & Sunset Countdown sheet (`🌤️`).
  4. Design Tab (`📍 Use My Location` + `📌 Pick on Map` + custom loop).
  5. Global City Search (`🌍 Explore City` — Tokyo / Sydney / Amsterdam).
- **App Review Notes**:
  > "SpinMap works immediately without an account. Curated Melbourne and Sydney cycling routes are bundled offline. Location access is optional — users can either tap 'Use My Location' or tap 'Pick on Map' / enter any city or suburb to generate bikeway routes."
