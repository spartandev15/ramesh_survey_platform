"use client";

import { Check, Copy, Download, ExternalLink, Link2, QrCode } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/modal";

const small = "inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50";
const primary = "inline-flex items-center gap-1.5 rounded-lg bg-brand-navy-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-navy-700";
const secondary = "inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50";

/** The shop's public survey link and its QR code, each in a popup (SR-13). */
export function PublicLink({ shopId, name, url, slug }: { shopId: string; name: string; url: string; slug: string }) {
  const [copied, setCopied] = useState(false);
  const qr = `/psg/shops/${shopId}/qr`;
  return (
    <div className="flex flex-wrap gap-1.5">
      <Modal
        title={`Public survey link: ${name}`}
        buttonClass={small}
        onOpen={() => setCopied(false)}
        label={
          <>
            <Link2 className="size-3.5" aria-hidden="true" />
            Link
          </>
        }
      >
        <p className="text-sm text-gray-600">Customers without an invitation can answer the survey here. Anyone with the link can open it.</p>
        <p className="mt-3 break-all rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs text-gray-900">{url}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={primary}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            {copied ? "Copied" : "Copy link"}
          </button>
          <a href={url} target="_blank" rel="noreferrer" className={secondary}>
            <ExternalLink className="size-4" aria-hidden="true" />
            Open
          </a>
        </div>
        <p role="status" className="sr-only">
          {copied ? "Link copied" : ""}
        </p>
      </Modal>
      <Modal
        title={`QR code: ${name}`}
        buttonClass={small}
        label={
          <>
            <QrCode className="size-3.5" aria-hidden="true" />
            QR code
          </>
        }
      >
        <p className="text-sm text-gray-600">Print it at the counter or on paperwork. It opens the same public link.</p>
        {/* Loads only when the popup opens. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt={`QR code for ${url}`} loading="lazy" width={240} height={240} className="mx-auto mt-4 size-60 rounded-xl border border-gray-100" />
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <a href={`${qr}?download=png`} download={`${slug}-survey-qr.png`} className={primary}>
            <Download className="size-4" aria-hidden="true" />
            Download PNG
          </a>
          <a href={`${qr}?download=svg`} download={`${slug}-survey-qr.svg`} className={secondary}>
            <Download className="size-4" aria-hidden="true" />
            Download SVG
          </a>
        </div>
      </Modal>
    </div>
  );
}
