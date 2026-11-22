//! Native lifecycle policy, independent of AppKit/Tauri so both OS paths can be
//! exercised on every build host. Saved is sent only after a successful checkpoint.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(super) struct CloseState {
    closing: bool,
    close_confirmed: bool,
    exit_requested: bool,
}
#[derive(Debug, Clone, Copy)]
pub(super) enum CloseEvent {
    Requested { exit: bool },
    Saved { macos: bool },
    Cancel,
}
#[derive(Debug, PartialEq, Eq)]
pub(super) enum CloseAction { Allow, Wait, RequestSave, Hide, Close, Exit }
impl CloseState {
    pub(super) fn apply(&mut self, event: CloseEvent) -> CloseAction {
        match event {
            CloseEvent::Requested { exit } => {
                if self.close_confirmed { return CloseAction::Allow; }
                self.exit_requested |= exit;
                if self.closing { return CloseAction::Wait; }
                self.closing = true;
                CloseAction::RequestSave
            }
            CloseEvent::Saved { macos } => {
                if !self.closing { return CloseAction::Wait; }
                if self.exit_requested {
                    self.close_confirmed = true;
                    CloseAction::Exit
                } else if macos {
                    // Hiding is not final termination: a new close or Quit must
                    // request another save, including edits made after Dock reopen.
                    *self = Self::default();
                    CloseAction::Hide
                } else {
                    self.close_confirmed = true;
                    CloseAction::Close
                }
            }
            CloseEvent::Cancel => { *self = Self::default(); CloseAction::Wait }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn windows_close_waits_for_save_then_allows_window_and_process_exit() {
        let mut state = CloseState::default();
        assert_eq!(state.apply(CloseEvent::Requested { exit: false }), CloseAction::RequestSave);
        assert_eq!(state.apply(CloseEvent::Requested { exit: false }), CloseAction::Wait);
        assert_eq!(state.apply(CloseEvent::Saved { macos: false }), CloseAction::Close);
        assert_eq!(state.apply(CloseEvent::Requested { exit: false }), CloseAction::Allow);
        assert_eq!(state.apply(CloseEvent::Requested { exit: true }), CloseAction::Allow);
    }
    #[test]
    fn macos_red_close_hides_and_each_reopen_close_and_quit_requires_a_new_save() {
        let mut state = CloseState::default();
        for _ in 0..2 {
            assert_eq!(state.apply(CloseEvent::Requested { exit: false }), CloseAction::RequestSave);
            assert_eq!(state.apply(CloseEvent::Saved { macos: true }), CloseAction::Hide);
            assert_eq!(state, CloseState::default());
        }
        assert_eq!(state.apply(CloseEvent::Requested { exit: true }), CloseAction::RequestSave);
        assert_eq!(state.apply(CloseEvent::Saved { macos: true }), CloseAction::Exit);
        assert_eq!(state.apply(CloseEvent::Requested { exit: true }), CloseAction::Allow);
    }
    #[test]
    fn quit_during_pending_window_save_promotes_intent_without_duplicate_save() {
        let mut state = CloseState::default();
        assert_eq!(state.apply(CloseEvent::Requested { exit: false }), CloseAction::RequestSave);
        assert_eq!(state.apply(CloseEvent::Requested { exit: true }), CloseAction::Wait);
        assert_eq!(state.apply(CloseEvent::Saved { macos: true }), CloseAction::Exit);
    }
    #[test]
    fn cancel_or_failed_native_action_resets_all_intent_and_allows_retry() {
        for macos in [false, true] {
            let mut state = CloseState::default();
            state.apply(CloseEvent::Requested { exit: true });
            state.apply(CloseEvent::Cancel);
            assert_eq!(state, CloseState::default());
            assert_eq!(state.apply(CloseEvent::Saved { macos }), CloseAction::Wait);
            assert_eq!(state.apply(CloseEvent::Requested { exit: false }), CloseAction::RequestSave);
            assert_eq!(state.apply(CloseEvent::Saved { macos }), if macos { CloseAction::Hide } else { CloseAction::Close });
            state.apply(CloseEvent::Cancel);
            assert_eq!(state.apply(CloseEvent::Requested { exit: true }), CloseAction::RequestSave);
        }
    }
}
