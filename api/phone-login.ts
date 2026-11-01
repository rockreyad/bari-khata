import {
  createManualPhoneHandler,
  manualPhoneConfig,
} from "../server/manualPhone.js";

export default {
  fetch(request: Request) {
    return createManualPhoneHandler(manualPhoneConfig(process.env))(request);
  },
};
