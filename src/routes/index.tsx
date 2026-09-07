import { createFileRoute } from "@tanstack/react-router";
import { Download, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Jenvu — ICT/SMC Gold Sidebar" },
      {
        name: "description",
        content:
          "Live gold sidebar with ICT/SMC AI analysis, screen sharing and trade plans. Preview the Chrome side panel and download the extension.",
      },
      { property: "og:title", content: "Jenvu — ICT/SMC Gold Sidebar" },
      {
        property: "og:description",
        content:
          "Preview the Jenvu side panel live and download the Chrome extension.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function download(file: string, name: string) {
  fetch(file)
    .then((res) => {
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch((err) => alert(err.message));
}

function Home() {
  return (
    <main className="min-h-dvh bg-surface px-4 py-8 text-foreground sm:px-6 lg:py-12">
      <div className="mx-auto grid max-w-5xl items-start gap-10 lg:grid-cols-[1fr_400px] lg:gap-16">
        <section className="pt-3 lg:sticky lg:top-12">
          <p className="text-sm font-semibold text-primary">Chrome side panel</p>
          <div className="mt-3 flex items-center gap-3">
            <img src="/jenvu-logo.png" alt="Jenvu logo" width={56} height={56} className="size-12 sm:size-14" />
            <h1 className="max-w-xl text-4xl font-semibold leading-tight sm:text-5xl">Jenvu</h1>
          </div>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
            Live gold analysis with ICT/SMC structure, liquidity, order blocks and chart screen reading—right beside your browser.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Button onClick={() => download("/gold-desk-extension.zip", "gold-desk-extension.zip")} size="lg" className="rounded-full px-6">
              <Download /> Download extension
            </Button>
            <Button onClick={() => download("/jenvu-project.zip", "jenvu-project.zip")} size="lg" variant="outline" className="rounded-full px-6">
              <Download /> Download project ZIP
            </Button>
          </div>

          <div className="mt-9 border-t border-border pt-6">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ExternalLink className="size-4 text-primary" /> Install in Chrome
            </div>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
            <li>Unzip the downloaded file.</li>
            <li>
              Open <code>chrome://extensions</code> in Chrome.
            </li>
            <li>Turn on Developer mode (top right).</li>
            <li>Click “Load unpacked” and select the folder.</li>
            <li>Click the toolbar icon to open the sidebar.</li>
            </ol>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[400px] shrink-0" aria-label="Live extension preview">
          <div className="overflow-hidden rounded-[24px] border border-border bg-card shadow-xl">
            <iframe
              src="/extension-preview/sidepanel.html"
              title="Jenvu sidebar preview"
              className="block h-[740px] w-full bg-background"
            />
          </div>
        </section>
      </div>
    </main>
  );
}
