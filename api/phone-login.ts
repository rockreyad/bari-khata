import {
  createManualPhoneHandler,
  manualPhoneConfig,
} from "../server/manualPhone.ts";

export default {
  fetch(request: Request) {
    return createManualPhoneHandler(manualPhoneConfig(process.env))(request);
  },
};
