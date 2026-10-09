"use client";

import { useSearchParams } from "next/navigation";
import { MessageList } from "@/components/portal/message-list";
import { MessageDetail } from "@/components/portal/message-detail";
import { Suspense, useState } from "react";
import { ComposeMessage } from "@/components/portal/compose-message";
import { Button } from "@/components/ui/button";

function InboxContent() {
  const searchParams = useSearchParams();
  const messageId = searchParams.get("id");
  const shiftId = searchParams.get("shiftId");
  const [compose, setCompose] = useState(!!shiftId);

  if (messageId) {
    return <MessageDetail />;
  }

  return <div className="flex-1">{shiftId && <><Button className="mb-4" onClick={() => setCompose(true)}>Nachricht zur Schicht verfassen</Button><ComposeMessage open={compose} onOpenChange={setCompose} shiftId={shiftId} defaultSubject="Nachricht zu deiner Schicht" /></>}<MessageList folder="inbox" /></div>;
}

export default function InboxPage() {
  return (
    <Suspense fallback={<div className="h-32 animate-pulse rounded bg-muted" />}>
      <InboxContent />
    </Suspense>
  );
}
