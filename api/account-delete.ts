import {
  accountDeleteConfig,
  createAccountDeleteHandler,
} from "../server/accountDelete.js";

export default {
  fetch(request: Request) {
    return createAccountDeleteHandler(accountDeleteConfig(process.env))(
      request,
    );
  },
};
