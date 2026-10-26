import { describe, expect, it } from "vitest";
import { redactSurveyLinks } from "./log-transport";

describe("survey links in logs (SR-40)", () => {
  it("redacts survey and opt-out tokens but keeps the rest of the email", () => {
    const token = "Qk3n9VbZ2xY7tR4pL0mA8sD1fG6hJ5kW3eU2iO9yT0c";
    const optOut = "2f5f22f4-0b0a-482a-91a9-88ee67080ef6.abcDEF123_-xyz789ABCdef456ghiJK";
    const text = `Hi Avery,\nStart: https://survey.test/survey/${token}\nStop emails: https://survey.test/survey/opt-out/${optOut}\nThanks`;
    const redacted = redactSurveyLinks(text);
    expect(redacted).not.toContain(token);
    expect(redacted).not.toContain(optOut);
    expect(redacted).toBe("Hi Avery,\nStart: https://survey.test/survey/[redacted]\nStop emails: https://survey.test/survey/opt-out/[redacted]\nThanks");
  });

  it("redacts password-reset links, which can take over an account", () => {
    const reset = "https://survey.test/api/auth/reset-password/aB3dE5fG7hJ9kL1mN3pQ?callbackURL=%2Freset-password";
    expect(redactSurveyLinks(`Set your password: ${reset}`)).toBe("Set your password: https://survey.test/api/auth/reset-password/[redacted]?callbackURL=%2Freset-password");
    expect(redactSurveyLinks("https://survey.test/reset-password?token=aB3dE5fG7hJ9kL1mN3pQ&x=1")).toBe("https://survey.test/reset-password?token=[redacted]&x=1");
  });

  it("leaves the public shop link alone, which carries no secret", () => {
    expect(redactSurveyLinks("https://survey.test/survey/shop/joes-body-shop")).toBe("https://survey.test/survey/shop/joes-body-shop");
  });
});
