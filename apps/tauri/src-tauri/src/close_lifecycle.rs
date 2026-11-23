//! Native lifecycle policy, independent of AppKit/Tauri so both OS paths can be
//! exercised on every build host. Saved is sent only after a successful checkpoint.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(super) struct CloseState {
    closing: bool,
    close_confirmed: bool,
    exit_requested: bool,
    listener_ready: bool,
    request_dispatched: bool,
}
#[derive(Debug, Clone, Copy)]
pub(super) enum CloseEvent {
    Requested { exit: bool },
    Saved { macos: bool },
    ListenerReady,
    ListenerDetached,
    Cancel,
}
#[derive(Debug, PartialEq, Eq)]
pub(super) enum CloseAction { Allow, Wait, RequestSave, Hide, Close, Exit }
impl CloseState {
    fn clear_request(&mut self) {
        *self = Self { listener_ready: self.listener_ready, ..Self::default() };
    }
    fn dispatch_pending(&mut self) -> CloseAction {
        if self.closing && !self.close_confirmed && self.listener_ready && !self.request_dispatched {
            self.request_dispatched = true;
            CloseAction::RequestSave
        } else { CloseAction::Wait }
    }
    pub(super) fn apply(&mut self, event: CloseEvent) -> CloseAction {
        match event {
            CloseEvent::Requested { exit } => {
                if self.close_confirmed { return CloseAction::Allow; }
                self.exit_requested |= exit;
                self.closing = true;
                self.dispatch_pending()
            }
            CloseEvent::Saved { macos } => {
                if !self.closing || !self.request_dispatched { return CloseAction::Wait; }
                if self.exit_requested {
                    self.close_confirmed = true;
                    CloseAction::Exit
                } else if macos {
                    // Hiding is not final termination: a new close or Quit must
                    // request another save, including edits made after Dock reopen.
                    self.clear_request();
                    CloseAction::Hide
                } else {
                    self.close_confirmed = true;
                    CloseAction::Close
                }
            }
            CloseEvent::ListenerReady => {
                self.listener_ready = true;
                self.dispatch_pending()
            }
            CloseEvent::ListenerDetached => {
                // A new frontend must reclaim pending intent; never discard an
                // early close/Quit just because the old window disappeared.
                self.listener_ready = false;
                self.request_dispatched = false;
                CloseAction::Wait
            }
            CloseEvent::Cancel => { self.clear_request(); CloseAction::Wait }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn listening() -> CloseState {
        let mut state = CloseState::default();
        assert_eq!(state.apply(CloseEvent::ListenerReady), CloseAction::Wait);
        state
    }
    #[test]
    fn early_close_waits_until_a_listener_can_receive_it() {
        let mut state = CloseState::default();
        assert_eq!(state.apply(CloseEvent::Requested { exit: false }), CloseAction::Wait);
        assert_eq!(state.apply(CloseEvent::Requested { exit: true }), CloseAction::Wait);
        assert_eq!(state.apply(CloseEvent::ListenerReady), CloseAction::RequestSave);
        assert_eq!(state.apply(CloseEvent::ListenerReady), CloseAction::Wait);
        assert_eq!(state.apply(CloseEvent::Saved { macos: true }), CloseAction::Exit);
    }
    #[test]
    fn early_window_close_is_claimed_once_and_keeps_listener_after_hiding() {
        let mut state = CloseState::default();
        assert_eq!(state.apply(CloseEvent::Requested { exit: false }), CloseAction::Wait);
        assert_eq!(state.apply(CloseEvent::Saved { macos: true }), CloseAction::Wait);
        assert_eq!(state.apply(CloseEvent::ListenerReady), CloseAction::RequestSave);
        assert_eq!(state.apply(CloseEvent::Requested { exit: false }), CloseAction::Wait);
        assert_eq!(state.apply(CloseEvent::Saved { macos: true }), CloseAction::Hide);
        assert_eq!(state, listening());
        assert_eq!(state.apply(CloseEvent::Requested { exit: false }), CloseAction::RequestSave);
    }
    #[test]
    fn recreated_listener_reclaims_pending_quit_without_losing_exit_intent() {
        let mut state = listening();
        assert_eq!(state.apply(CloseEvent::Requested { exit: true }), CloseAction::RequestSave);
        state.apply(CloseEvent::ListenerDetached);
        assert_eq!(state.apply(CloseEvent::Requested { exit: false }), CloseAction::Wait);
        assert_eq!(state.apply(CloseEvent::ListenerReady), CloseAction::RequestSave);
        assert_eq!(state.apply(CloseEvent::ListenerReady), CloseAction::Wait);
        assert_eq!(state.apply(CloseEvent::Saved { macos: true }), CloseAction::Exit);
    }
    #[test]
    fn cancelled_early_request_is_not_replayed_on_registration() {
        let mut state = CloseState::default();
        state.apply(CloseEvent::Requested { exit: true });
        state.apply(CloseEvent::Cancel);
        assert_eq!(state.apply(CloseEvent::ListenerReady), CloseAction::Wait);
        assert_eq!(state.apply(CloseEvent::Requested { exit: false }), CloseAction::RequestSave);
        assert_eq!(state.apply(CloseEvent::Saved { macos: false }), CloseAction::Close);
    }
    #[test]
    fn windows_close_waits_for_save_then_allows_window_and_process_exit() {
        let mut state = listening();
        assert_eq!(state.apply(CloseEvent::Requested { exit: false }), CloseAction::RequestSave);
        assert_eq!(state.apply(CloseEvent::Requested { exit: false }), CloseAction::Wait);
        assert_eq!(state.apply(CloseEvent::Saved { macos: false }), CloseAction::Close);
        assert_eq!(state.apply(CloseEvent::Requested { exit: false }), CloseAction::Allow);
        assert_eq!(state.apply(CloseEvent::Requested { exit: true }), CloseAction::Allow);
    }
    #[test]
    fn macos_red_close_hides_and_each_reopen_close_and_quit_requires_a_new_save() {
        let mut state = listening();
        for _ in 0..2 {
            assert_eq!(state.apply(CloseEvent::Requested { exit: false }), CloseAction::RequestSave);
            assert_eq!(state.apply(CloseEvent::Saved { macos: true }), CloseAction::Hide);
            assert_eq!(state, listening());
        }
        assert_eq!(state.apply(CloseEvent::Requested { exit: true }), CloseAction::RequestSave);
        assert_eq!(state.apply(CloseEvent::Saved { macos: true }), CloseAction::Exit);
        assert_eq!(state.apply(CloseEvent::Requested { exit: true }), CloseAction::Allow);
    }
    #[test]
    fn quit_during_pending_window_save_promotes_intent_without_duplicate_save() {
        let mut state = listening();
        assert_eq!(state.apply(CloseEvent::Requested { exit: false }), CloseAction::RequestSave);
        assert_eq!(state.apply(CloseEvent::Requested { exit: true }), CloseAction::Wait);
        assert_eq!(state.apply(CloseEvent::Saved { macos: true }), CloseAction::Exit);
    }
    #[test]
    fn cancel_or_failed_native_action_resets_all_intent_and_allows_retry() {
        for macos in [false, true] {
            let mut state = listening();
            state.apply(CloseEvent::Requested { exit: true });
            state.apply(CloseEvent::Cancel);
            assert_eq!(state, listening());
            assert_eq!(state.apply(CloseEvent::Saved { macos }), CloseAction::Wait);
            assert_eq!(state.apply(CloseEvent::Requested { exit: false }), CloseAction::RequestSave);
            assert_eq!(state.apply(CloseEvent::Saved { macos }), if macos { CloseAction::Hide } else { CloseAction::Close });
            state.apply(CloseEvent::Cancel);
            assert_eq!(state.apply(CloseEvent::Requested { exit: true }), CloseAction::RequestSave);
        }
    }
}
