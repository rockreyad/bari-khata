// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import userEvent from "@testing-library/user-event";
import { LoginPage } from "./LoginPage";

const api = vi.hoisted(() => ({
  request: vi.fn(),
  verify: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock("./AuthProvider", () => ({
  useAuth: () => ({
    phoneOtpEnabled: true,
    phoneAuthMode: "manual",
    requestPhoneOtp: api.request,
    verifyPhoneOtp: api.verify,
    signIn: api.signIn,
  }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (value: string) => value,
    formatDigits: String,
    number: String,
  }),
}));
function RouteProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="route">
        {location.pathname}
        {location.search}
      </output>
      <output data-testid="state">{JSON.stringify(location.state)}</output>
      <button onClick={() => navigate(-1)}>Browser back</button>
      <button onClick={() => navigate(1)}>Browser forward</button>
    </>
  );
}
function mount(
  path = "/login",
  state: unknown = { from: "/sectors/door?tab=labour" },
) {
  const success = vi.fn();
  return {
    ...render(
      <MemoryRouter initialEntries={[{ pathname: path, state }]}>
        <RouteProbe />
        <Routes>
          <Route path="/login/*" element={<LoginPage onSuccess={success} />} />
        </Routes>
      </MemoryRouter>,
    ),
    success,
  };
}
async function expectPinRoute() {
  await screen.findByRole("heading", { name: "PIN লিখুন" });
  await waitFor(() => {
    expect(screen.getByTestId("route").textContent).toBe("/login/pin");
    expect(
      (screen.getByLabelText("প্রবেশের কোড") as HTMLInputElement).disabled,
    ).toBe(false);
  });
}
async function expectNumberRoute() {
  await waitFor(() =>
    expect(screen.getByTestId("route").textContent).toBe("/login"),
  );
  return screen.findByLabelText("ফোন নম্বর", { exact: true });
}
beforeEach(() => {
  api.request.mockResolvedValue({ retryAfter: 60 });
  api.verify.mockResolvedValue(undefined);
  api.signIn.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it.each([
  "01712345678",
  "1712345678",
  "০১৭১২৩৪৫৬৭৮",
  "১৭১২৩৪৫৬৭৮",
  "+880 1712-345678",
  "8801712345678",
  "008801712345678",
])(
  "opens a separate PIN route for %s without putting phone or PIN into navigation state",
  async (phone) => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByRole("img", { name: "বাংলাদেশ" })).toBeTruthy();
    expect(screen.getByLabelText("বাংলাদেশের কোড").textContent).toBe("+880");
    await user.type(screen.getByLabelText("ফোন নম্বর", { exact: true }), phone);
    await user.click(screen.getByRole("button", { name: "এগিয়ে যাই" }));
    await expectPinRoute();
    expect(api.request).toHaveBeenCalledExactlyOnceWith("+8801712345678");
    expect(screen.getByTestId("route").textContent).toBe("/login/pin");
    expect(screen.getByTestId("state").textContent).toBe(
      '{"from":"/sectors/door?tab=labour"}',
    );
    expect(screen.getByRole("heading", { name: "PIN লিখুন" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("প্রবেশের কোড"));
    expect(screen.queryByLabelText("ফোন নম্বর", { exact: true })).toBeNull();
    expect(screen.queryByRole("link", { name: "নমুনা দেখুন" })).toBeNull();
    expect(api.verify).not.toHaveBeenCalled();
  },
);
it("returns a direct PIN URL to the number page and retains the destination without credentials", async () => {
  mount("/login/pin", {
    from: "/works/example",
    pin: "1318",
    phone: "01712345678",
  });
  await expectNumberRoute();
  expect(screen.getByTestId("route").textContent).toBe("/login");
  expect(screen.getByTestId("state").textContent).toBe(
    '{"from":"/works/example"}',
  );
  expect(
    (screen.getByLabelText("ফোন নম্বর", { exact: true }) as HTMLInputElement)
      .value,
  ).toBe("");
  expect(api.request).not.toHaveBeenCalled();
  expect(api.verify).not.toHaveBeenCalled();
});
it("restarts the number step on reload because the challenge and PIN are only held in memory", async () => {
  const user = userEvent.setup();
  const first = mount();
  await user.type(
    screen.getByLabelText("ফোন নম্বর", { exact: true }),
    "01712345678",
  );
  await user.click(screen.getByRole("button", { name: "এগিয়ে যাই" }));
  await expectPinRoute();
  await user.type(screen.getByLabelText("প্রবেশের কোড"), "1318");
  first.unmount();
  mount("/login/pin");
  await expectNumberRoute();
  expect(screen.getByTestId("route").textContent).toBe("/login");
  expect(screen.queryByLabelText("প্রবেশের কোড")).toBeNull();
  expect(api.verify).not.toHaveBeenCalled();
});
it("clears the typed PIN when browser back returns to the number step", async () => {
  const user = userEvent.setup();
  mount();
  await user.type(
    screen.getByLabelText("ফোন নম্বর", { exact: true }),
    "01712345678",
  );
  await user.click(screen.getByRole("button", { name: "এগিয়ে যাই" }));
  await expectPinRoute();
  await user.type(screen.getByLabelText("প্রবেশের কোড"), "1318");
  await user.click(screen.getByRole("button", { name: "Browser back" }));
  await expectNumberRoute();
  expect(screen.getByTestId("route").textContent).toBe("/login");
  expect(
    (screen.getByLabelText("ফোন নম্বর", { exact: true }) as HTMLInputElement)
      .value,
  ).toBe("01712345678");
  await user.click(screen.getByRole("button", { name: "Browser forward" }));
  await expectPinRoute();
  expect(screen.getByTestId("route").textContent).toBe("/login/pin");
  expect(
    (screen.getByLabelText("প্রবেশের কোড") as HTMLInputElement).value,
  ).toBe("");
  expect(api.verify).not.toHaveBeenCalled();
});
it("replaces the PIN page when changing the number and requests a new canonical challenge", async () => {
  const user = userEvent.setup();
  mount();
  await user.type(
    screen.getByLabelText("ফোন নম্বর", { exact: true }),
    "01712345678",
  );
  await user.click(screen.getByRole("button", { name: "এগিয়ে যাই" }));
  await expectPinRoute();
  await user.click(await screen.findByRole("button", { name: "নম্বর বদলাই" }));
  await expectNumberRoute();
  expect(screen.getByTestId("route").textContent).toBe("/login");
  const field = screen.getByLabelText("ফোন নম্বর", { exact: true });
  await user.clear(field);
  await user.type(field, "1812345678");
  await user.click(screen.getByRole("button", { name: "এগিয়ে যাই" }));
  await expectPinRoute();
  expect(api.request).toHaveBeenLastCalledWith("+8801812345678");
  await user.type(screen.getByLabelText("প্রবেশের কোড"), "1318");
  await user.click(screen.getByRole("button", { name: "খাতা খুলুন" }));
  await waitFor(() =>
    expect(api.verify).toHaveBeenCalledExactlyOnceWith(
      "+8801812345678",
      "1318",
    ),
  );
});
it("does not enter a PIN route from invalid or incomplete national numbers", async () => {
  const user = userEvent.setup();
  mount();
  const field = screen.getByLabelText("ফোন নম্বর", { exact: true });
  await user.type(field, "1123456789");
  await user.click(screen.getByRole("button", { name: "এগিয়ে যাই" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "সঠিক বাংলাদেশি",
  );
  expect(screen.getByTestId("route").textContent).toBe("/login");
  expect(api.request).not.toHaveBeenCalled();
});
it("does not navigate after a pending request resolves on an unmounted page", async () => {
  let finish!: () => void;
  api.request.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = mount();
  fireEvent.change(screen.getByLabelText("ফোন নম্বর", { exact: true }), {
    target: { value: "1712345678" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "এগিয়ে যাই" }));
  });
  view.unmount();
  await act(async () => {
    finish();
  });
  expect(view.success).not.toHaveBeenCalled();
  expect(api.verify).not.toHaveBeenCalled();
});
