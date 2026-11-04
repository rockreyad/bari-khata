import {
  createSharedReceiptHandler,
  sharedReceiptConfig,
} from "../server/sharedReceipt.js";
export default {
  fetch(request: Request) {
    return createSharedReceiptHandler(sharedReceiptConfig(process.env))(
      request,
    );
  },
};
