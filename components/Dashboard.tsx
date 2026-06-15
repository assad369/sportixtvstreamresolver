"use client";

import { useCallback, useEffect, useState } from "react";
import PlayerEmbed from "@/components/PlayerEmbed";
import type { StreamDTO } from "@/types/stream";

export default function Dashboard() {
  const [streams, setStreams] = useState<StreamDTO[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch("/api/admin/streams", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setStreams(data.streams ?? []);
      }
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function onCreated(stream: StreamDTO) {
    setStreams((prev) => [stream, ...prev]);
  }

  function onUpdated(stream: StreamDTO) {
    setStreams((prev) => prev.map((s) => (s.id === stream.id ? stream : s)));
  }

  function onDeleted(id: string) {
    setStreams((prev) => prev.filter((s) => s.id !== id));
  }

  return (
    <div className="flex flex-col gap-8">
      <CreateForm onCreated={onCreated} />

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-white">
          Streams{" "}
          <span className="text-sm font-normal text-white/40">
            ({streams.length})
          </span>
        </h2>

        {loadingList ? (
          <p className="text-sm text-white/40">Loading…</p>
        ) : streams.length === 0 ? (
          <p className="text-sm text-white/40">
            No streams yet. Create one above.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {streams.map((s) => (
              <StreamCard
                key={s.id}
                stream={s}
                origin={origin}
                onUpdated={onUpdated}
                onDeleted={onDeleted}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated: (s: StreamDTO) => void }) {
  const [name, setName] = useState("");
  const [embedUrl, setEmbedUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), embedUrl: embedUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Failed to create stream.");
        return;
      }
      onCreated(data.stream);
      setName("");
      setEmbedUrl("");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-5">
      <h2 className="mb-4 text-lg font-semibold text-white">New stream</h2>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Stream name (e.g. Willow Cricket)"
          disabled={loading}
          className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50"
        />
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="url"
            required
            value={embedUrl}
            onChange={(e) => setEmbedUrl(e.target.value)}
            placeholder="https://embed.st/embed/admin/admin-willow-cricket/1"
            disabled={loading}
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Extracting…
              </>
            ) : (
              "Create"
            )}
          </button>
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
      </form>
    </section>
  );
}

function StreamCard({
  stream,
  origin,
  onUpdated,
  onDeleted,
}: {
  stream: StreamDTO;
  origin: string;
  onUpdated: (s: StreamDTO) => void;
  onDeleted: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const embedUrl = `${origin}/embed/${stream.publicId}`;
  const iframeSnippet = `<iframe src="${embedUrl}" allowfullscreen frameborder="0" width="640" height="360"></iframe>`;

  async function toggleEnabled() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/streams/${stream.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !stream.enabled }),
      });
      if (res.ok) {
        const data = await res.json();
        onUpdated(data.stream);
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${stream.name}"? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/streams/${stream.id}`, {
        method: "DELETE",
      });
      if (res.ok) onDeleted(stream.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-white">{stream.name}</h3>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${
              stream.enabled
                ? "border-green-500/40 bg-green-500/10 text-green-300"
                : "border-white/15 bg-white/5 text-white/50"
            }`}
          >
            {stream.enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleEnabled}
            disabled={busy}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10 disabled:opacity-50"
          >
            {stream.enabled ? "Disable" : "Enable"}
          </button>
          <button
            onClick={() => setShowPreview((v) => !v)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10"
          >
            {showPreview ? "Hide preview" : "Preview"}
          </button>
          <button
            onClick={remove}
            disabled={busy}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 transition hover:bg-red-500/20 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <CopyField label="Embed URL" value={embedUrl} />
        <CopyField label="Iframe code" value={iframeSnippet} mono />
        {stream.lastM3u8Url ? (
          <CopyField label="M3U8 URL" value={stream.lastM3u8Url} mono />
        ) : (
          <div>
            <label className="mb-1 block text-xs font-medium text-white/40">
              M3U8 URL
            </label>
            <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/40">
              Not resolved yet
            </p>
          </div>
        )}
      </div>

      {showPreview && stream.enabled && (
        <div className="mt-4 overflow-hidden rounded-lg border border-white/10 bg-black">
          <div className="aspect-video">
            <PlayerEmbed
              src={`/api/proxy?id=${encodeURIComponent(stream.publicId)}`}
              className="h-full w-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function CopyField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-white/40">
        {label}
      </label>
      <div className="flex items-stretch gap-2">
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className={`flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 outline-none ${mono ? "font-mono" : ""}`}
        />
        <button
          onClick={copy}
          className="rounded-lg border border-white/10 bg-white/5 px-4 text-xs font-medium text-white/80 transition hover:bg-white/10"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
