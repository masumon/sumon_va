import * as Haptics from 'expo-haptics';

// One tiny, always-safe surface for tactile feedback. Every call is fire-and-forget and
// swallows errors — haptics are a nicety, never load-bearing, and some devices / the web
// build have no motor at all. Keep the vocabulary small so the whole app feels consistent:
//   tapLight  — a confirm / primary button press
//   tapSelect — moving between options (tabs, segmented controls, filter chips)
//   success   — an item was created or completed
//   warn      — a destructive confirm

export function tapLight(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function tapSelect(): void {
  void Haptics.selectionAsync().catch(() => {});
}

export function success(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function warn(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}
