import { reconcileRegistrations } from "./services/registration";

chrome.runtime.onInstalled.addListener(() => {
  reconcile();
});

chrome.runtime.onStartup.addListener(() => {
  reconcile();
});

chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage().catch((error: unknown) => {
    console.error(error);
  });
});

const reconcile = (): void => {
  void reconcileRegistrations()
    .then((error) => {
      if (error !== null) {
        console.error(error.message);
      }
    })
    .catch((error: unknown) => {
      console.error(error);
    });
};
