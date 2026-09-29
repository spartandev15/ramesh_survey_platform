import type { Metadata } from "next";
import { headers } from "next/headers";
import { CheckCircle2, Clock, Link2Off } from "lucide-react";
import { env } from "@/lib/env";
import { clientAddress } from "@/lib/rate-limit";
import { openSurvey, RateLimitedError } from "@/modules/responses/respondent";
import type { SurveyContext, TokenState } from "@/modules/responses/store";
import { ShopHeader } from "../shop-header";
import { RenewalButton } from "./renewal-button";
import { RespondentForm } from "./respondent-form";

// No indexing, no referrer, no third-party scripts on respondent pages (PDF 04).
export const metadata: Metadata = { title: "Customer survey", robots: { index: false, follow: false }, referrer: "no-referrer" };

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "long" });

export default async function SurveyPage({ params }: PageProps<"/survey/[token]">) {
  const { token } = await params;
  let state: TokenState | "rate_limited";
  try {
    state = await openSurvey(token, clientAddress(await headers()));
  } catch (error) {
    if (!(error instanceof RateLimitedError)) throw error;
    state = "rate_limited";
  }

  if (state === "rate_limited") {
    return <Notice icon={<Clock aria-hidden="true" className="size-8 text-amber-600" />} title="Please wait a moment" body="Too many requests came from this connection. Wait a minute, then reload the page." />;
  }
  // Same neutral page for unknown, altered or revoked links: nothing is revealed (AT-12).
  if (state.state === "invalid") {
    return <Notice icon={<Link2Off aria-hidden="true" className="size-8 text-gray-500" />} title="This survey link is not valid" body="Check that the whole link was copied. If it still does not work, contact the shop that sent it." />;
  }

  const { context } = state;
  return (
    <div className="min-h-screen bg-surface">
      <ShopHeader name={context.shop.name} logoUrl={context.shop.logoUrl} brandColor={context.shop.brandColor} />
      {context.isTest && <TestBanner />}
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="rounded-2xl bg-white p-5 shadow-sm sm:p-8">
          {state.state === "open" && (
            <>
              <p className="mb-6 text-sm text-gray-600">
                {context.shop.name} would like your feedback on your recent repair. Your answers are saved as you go, so you can finish later with this same link.
              </p>
              <RespondentForm
                token={token}
                definition={context.definition}
                initialAnswers={state.answers}
                initialRevision={state.revision}
                initialSavedAt={state.savedAt?.toISOString() ?? null}
              />
            </>
          )}
          {state.state === "submitted" && <Submitted context={context} submittedAt={state.submittedAt} />}
          {state.state === "expired" && <Expired context={context} token={token} />}
        </div>
      </main>
    </div>
  );
}

/** A completed survey stays a locked confirmation, never an editable form (AT-17, AT-21). */
function Submitted({ context, submittedAt }: { context: SurveyContext; submittedAt: Date }) {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <CheckCircle2 aria-hidden="true" className="size-12 text-emerald-600" />
      <h1 className="mt-4 text-2xl font-semibold text-brand-navy-900">Thank you for your feedback</h1>
      <p className="mt-2 max-w-md text-gray-600">
        Your survey for {context.shop.name} was submitted on {dateFormat.format(submittedAt)}. Your answers are saved and can no longer be changed.
      </p>
    </div>
  );
}

/**
 * Expired and unanswered: no access to the content (SR-21). The respondent may
 * ask for a new link to the address on record; the reply is the same either way (SR-22).
 */
function Expired({ context, token }: { context: SurveyContext; token: string }) {
  const help = env().SURVEY_HELP_EMAIL;
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <Clock aria-hidden="true" className="size-12 text-amber-600" />
      <h1 className="mt-4 text-2xl font-semibold text-brand-navy-900">This survey link has expired</h1>
      <p className="mt-2 max-w-md text-gray-600">
        You can still share your feedback with {context.shop.name}. We can email a new link to the address on file for your visit. Any answers you saved are kept.
      </p>
      <RenewalButton token={token} />
      {/* The same neutral path whatever the reason (opted out, no address, not eligible): nothing is revealed (PDF 03 §3). */}
      <p className="mt-4 max-w-md text-xs text-gray-500">
        If no email arrives within a few minutes,{" "}
        {help ? (
          <>
            write to the survey help team at{" "}
            <a href={`mailto:${help}`} className="text-brand-navy-900 underline underline-offset-2">
              {help}
            </a>
          </>
        ) : (
          `contact ${context.shop.name}`
        )}
        .
      </p>
    </div>
  );
}

function TestBanner() {
  return (
    <p className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900">
      Test survey for internal testing only. Answers are test data and never count in reports.
    </p>
  );
}

function Notice({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
        <div className="flex justify-center">{icon}</div>
        <h1 className="mt-4 text-xl font-semibold text-brand-navy-900">{title}</h1>
        <p className="mt-2 text-gray-600">{body}</p>
      </div>
    </main>
  );
}
