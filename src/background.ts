import { reconcileRegistrations } from "./services/registration";
import { withScriptMutation } from "./services/script-actions";
import { migrateSiteOverrides } from "./services/storage";

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
  void withScriptMutation(async () => {
    await migrateSiteOverrides();
    return reconcileRegistrations();
  })
    .then((error) => {
      if (error !== null) {
        console.error(error.message);
      }
    })
    .catch((error: unknown) => {
      console.error(error);
    });
};
