import SwiftUI

struct ElevationScrubberView: View {
    let route: CyclingRoute
    @Binding var scrubRatio: Double
    let onScrubBegan: () -> Void

    @State private var lastHapticStep: Int = -1

    var body: some View {
        let profile = route.elevProfile.isEmpty ? [10.0, 12.0, 10.0] : route.elevProfile
        let minE = profile.min() ?? 0
        let maxE = profile.max() ?? 10
        // Minimum 140m vertical ceiling keeps flat rides visibly flat (never fake Alps!)
        let span = max(maxE - minE, 140.0)
        let currentAlt = CyclingMath.elevationAt(profile: profile, ratio: scrubRatio)
        let currentKm = route.distanceKm * scrubRatio
        let landmark = CyclingMath.nearestLandmark(in: route, ratio: scrubRatio)
        let strokeColor = Color(hex: route.ribbonHex)

        VStack(alignment: .leading, spacing: 6) {
            HStack {
                if let lm = landmark {
                    Text("\(lm.icon) \(lm.label)")
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Text(String(format: "%.1f km · Alt %d m", currentKm, currentAlt))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            GeometryReader { geo in
                let w = max(1, geo.size.width)
                let h = max(1, geo.size.height)
                let padX: CGFloat = 8
                let padY: CGFloat = 8

                Canvas { context, size in
                    let plotW = size.width - padX * 2
                    let plotH = size.height - padY * 2

                    var linePath = Path()
                    var areaPath = Path()
                    for (idx, val) in profile.enumerated() {
                        let t = profile.count > 1 ? CGFloat(idx) / CGFloat(profile.count - 1) : 0
                        let x = padX + t * plotW
                        let y = size.height - padY - CGFloat((val - minE) / span) * plotH
                        if idx == 0 {
                            linePath.move(to: CGPoint(x: x, y: y))
                            areaPath.move(to: CGPoint(x: x, y: size.height - 2))
                            areaPath.addLine(to: CGPoint(x: x, y: y))
                        } else {
                            linePath.addLine(to: CGPoint(x: x, y: y))
                            areaPath.addLine(to: CGPoint(x: x, y: y))
                        }
                    }
                    areaPath.addLine(to: CGPoint(x: padX + plotW, y: size.height - 2))
                    areaPath.closeSubpath()

                    context.fill(areaPath, with: .color(strokeColor.opacity(0.20)))
                    context.stroke(
                        linePath,
                        with: .color(strokeColor),
                        style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round)
                    )

                    // Landmark dots
                    for lm in route.landmarks {
                        let lx = padX + CGFloat(lm.ratio) * plotW
                        let altVal = Double(CyclingMath.elevationAt(profile: profile, ratio: lm.ratio))
                        let ly = size.height - padY - CGFloat((altVal - minE) / span) * plotH
                        let dotRect = CGRect(x: lx - 3.5, y: ly - 3.5, width: 7, height: 7)
                        context.fill(Path(ellipseIn: dotRect), with: .color(.white))
                        context.stroke(Path(ellipseIn: dotRect), with: .color(strokeColor), lineWidth: 1.8)
                    }

                    // Active scrubber vertical line & puck
                    let cx = padX + CGFloat(scrubRatio) * plotW
                    let cy = size.height - padY - CGFloat((Double(currentAlt) - minE) / span) * plotH
                    var guide = Path()
                    guide.move(to: CGPoint(x: cx, y: 2))
                    guide.addLine(to: CGPoint(x: cx, y: size.height - 2))
                    context.stroke(
                        guide,
                        with: .color(.primary.opacity(0.45)),
                        style: StrokeStyle(lineWidth: 1.2, dash: [3, 3])
                    )

                    let puckRect = CGRect(x: cx - 5.5, y: cy - 5.5, width: 11, height: 11)
                    context.fill(Path(ellipseIn: puckRect), with: .color(Color("AccentColor")))
                    context.stroke(Path(ellipseIn: puckRect), with: .color(.white), lineWidth: 2)
                }
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            onScrubBegan()
                            let raw = Double((value.location.x - padX) / max(1, w - padX * 2))
                            scrubRatio = max(0, min(1, raw))
                            let step = Int((scrubRatio * 10).rounded())
                            if step != lastHapticStep {
                                lastHapticStep = step
                            }
                        }
                )
            }
            .frame(height: 58)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color(.separator).opacity(0.4), lineWidth: 1)
            )
            .sensoryFeedback(.selection, trigger: lastHapticStep)
            .accessibilityElement()
            .accessibilityLabel("Route elevation scrubber")
            .accessibilityValue("\(Int(scrubRatio * 100)) percent, altitude \(currentAlt) meters")
            .accessibilityAdjustableAction { direction in
                onScrubBegan()
                switch direction {
                case .increment: scrubRatio = min(1, scrubRatio + 0.05)
                case .decrement: scrubRatio = max(0, scrubRatio - 0.05)
                @unknown default: break
                }
            }
        }
    }
}
