import Link from "next/link";
import { ChevronLeft, MessageCircle, Search, Send } from "lucide-react";

import { sendChatMessageAction } from "@/app/dashboard/chat/actions";
import { ChatAutoRefresh } from "@/components/chat/chat-auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { CHAT_ELIGIBLE_ROLES } from "@/lib/chat";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { assertChurch, requireChurchContext } from "@/lib/tenant";
import { cn, getInitials, toStartCase } from "@/lib/utils";

type SearchParams = {
  threadId?: string;
  peerId?: string;
  q?: string;
  error?: string;
};

const CHAT_ERRORS: Record<string, string> = {
  invalid_message: "Message could not be sent. Check that content is not empty.",
  thread_not_found: "Conversation was not found or no longer available.",
  recipient_not_found: "Recipient was not found or cannot receive chat messages.",
};

function formatConversationTime(value: Date) {
  const now = new Date();
  const sameDay =
    value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth() &&
    value.getDate() === now.getDate();
  if (sameDay) {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(value);
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(value);
}

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireChurchContext();
  const churchId = assertChurch(context.churchId);
  const params = await searchParams;

  if (!hasPermission(context.role, "chat:use")) {
    return (
      <Card>
        <CardTitle>Chat Access Restricted</CardTitle>
        <CardDescription className="mt-1">
          Your role does not include leadership chat access.
        </CardDescription>
      </Card>
    );
  }

  const [peers, threadRows] = await Promise.all([
    db.user.findMany({
      where: {
        churchId,
        isActive: true,
        role: { in: CHAT_ELIGIBLE_ROLES },
        id: { not: context.userId },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
    db.chatThread.findMany({
      where: {
        churchId,
        participants: {
          some: { userId: context.userId },
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            content: true,
            senderId: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      take: 100,
    }),
  ]);

  const threads = threadRows
    .map((thread) => {
      const me = thread.participants.find((participant) => participant.userId === context.userId) ?? null;
      const other = thread.participants.find((participant) => participant.userId !== context.userId)?.user ?? null;
      const lastMessage = thread.messages[0] ?? null;
      const isUnread = Boolean(
        lastMessage &&
          lastMessage.senderId !== context.userId &&
          (!me?.lastReadAt || lastMessage.createdAt > me.lastReadAt),
      );

      if (!other) return null;

      return {
        id: thread.id,
        other,
        lastMessage,
        lastActivityAt: thread.lastMessageAt ?? lastMessage?.createdAt ?? thread.updatedAt,
        isUnread,
      };
    })
    .filter((thread): thread is NonNullable<typeof thread> => thread !== null)
    .sort(
      (first, second) =>
        second.lastActivityAt.getTime() - first.lastActivityAt.getTime() ||
        first.other.name.localeCompare(second.other.name),
    );

  const selectedThreadById = params.threadId ? threads.find((thread) => thread.id === params.threadId) ?? null : null;
  const selectedThreadByPeer = params.peerId
    ? threads.find((thread) => thread.other.id === params.peerId) ?? null
    : null;
  const selectedThreadSummary = selectedThreadById ?? selectedThreadByPeer ?? null;
  const selectedPeer = selectedThreadSummary?.other ?? (params.peerId ? peers.find((peer) => peer.id === params.peerId) ?? null : null);

  const selectedThread = selectedThreadSummary
    ? await db.chatThread.findFirst({
        where: {
          id: selectedThreadSummary.id,
          churchId,
          participants: {
            some: { userId: context.userId },
          },
        },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  role: true,
                },
              },
            },
          },
          messages: {
            orderBy: { createdAt: "asc" },
            take: 300,
            include: {
              sender: {
                select: {
                  id: true,
                  name: true,
                  role: true,
                },
              },
            },
          },
        },
      })
    : null;

  if (selectedThread) {
    await db.chatParticipant.updateMany({
      where: {
        threadId: selectedThread.id,
        userId: context.userId,
      },
      data: {
        lastReadAt: new Date(),
      },
    });
  }

  const activePeer =
    selectedThread?.participants.find((participant) => participant.userId !== context.userId)?.user ?? selectedPeer;
  const hasOpenConversation = Boolean(selectedThread || activePeer);
  const errorMessage = params.error ? CHAT_ERRORS[params.error] ?? "Unable to complete chat action." : null;
  const searchQuery = params.q?.trim().toLowerCase() ?? "";
  const filteredThreads = searchQuery
    ? threads.filter((thread) => {
        const haystack = `${thread.other.name} ${thread.other.email} ${thread.lastMessage?.content ?? ""}`.toLowerCase();
        return haystack.includes(searchQuery);
      })
    : threads;
  const peerIdsWithThread = new Set(threads.map((thread) => thread.other.id));
  const peersWithoutThread = peers.filter((peer) => !peerIdsWithThread.has(peer.id));
  const filteredPeersWithoutThread = searchQuery
    ? peersWithoutThread.filter((peer) => `${peer.name} ${peer.email} ${peer.role}`.toLowerCase().includes(searchQuery))
    : peersWithoutThread;

  return (
    <div className="space-y-4">
      <ChatAutoRefresh enabled={Boolean(selectedThread)} />

      {errorMessage ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</p>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="grid min-h-[75vh] gap-0 lg:grid-cols-[360px_1fr]">
          <aside className={cn("border-r border-slate-200 bg-white", hasOpenConversation ? "hidden lg:block" : "")}>
            <div className="border-b border-slate-200 px-4 py-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-lg">Conversations</CardTitle>
                  <CardDescription className="mt-1">{peers.length} leadership contacts</CardDescription>
                </div>
                <Badge className="bg-emerald-600 text-white">Online</Badge>
              </div>
              <form method="get" className="mt-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    name="q"
                    defaultValue={params.q ?? ""}
                    placeholder="Search conversations"
                    className="h-10 w-full rounded-xl border border-slate-300 bg-white pr-3 pl-9 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  />
                </div>
              </form>
            </div>

            <div className="max-h-[calc(75vh-90px)] space-y-4 overflow-y-auto p-3">
              <section>
                <p className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Recent</p>
                <div className="mt-2 space-y-1.5">
                  {filteredThreads.map((thread) => (
                    <Link
                      key={thread.id}
                      href={`/dashboard/chat?threadId=${thread.id}`}
                      className={cn(
                        "block rounded-xl border px-3 py-2.5 transition",
                        selectedThreadSummary?.id === thread.id
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-transparent hover:border-slate-200 hover:bg-slate-50",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900">{thread.other.name}</p>
                        <span className="shrink-0 text-[11px] text-slate-500">{formatConversationTime(thread.lastActivityAt)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className="truncate text-xs text-slate-600">{thread.lastMessage?.content ?? "No messages yet."}</p>
                        {thread.isUnread ? (
                          <span className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                        ) : null}
                      </div>
                    </Link>
                  ))}
                  {filteredThreads.length === 0 ? (
                    <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                      No recent conversations for this search.
                    </p>
                  ) : null}
                </div>
              </section>

              <section>
                <p className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Start new</p>
                <div className="mt-2 space-y-1.5">
                  {filteredPeersWithoutThread.map((peer) => (
                    <Link
                      key={peer.id}
                      href={`/dashboard/chat?peerId=${peer.id}`}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 transition",
                        params.peerId === peer.id && !selectedThreadSummary
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-transparent hover:border-slate-200 hover:bg-slate-50",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{peer.name}</p>
                        <p className="truncate text-xs text-slate-500">{toStartCase(peer.role)}</p>
                      </div>
                      <Badge className="border border-slate-200 bg-white text-slate-700">New</Badge>
                    </Link>
                  ))}
                  {filteredPeersWithoutThread.length === 0 ? (
                    <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                      No new contacts available.
                    </p>
                  ) : null}
                </div>
              </section>
            </div>
          </aside>

          <section className={cn("flex min-h-[75vh] flex-col", hasOpenConversation ? "" : "hidden lg:flex")}>
            {hasOpenConversation ? (
              <>
                <header className="border-b border-slate-200 bg-[#f0f2f5] px-3 py-3 sm:px-4">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <Link
                      href="/dashboard/chat"
                      className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-300 px-2 text-slate-700 hover:bg-white lg:hidden"
                      aria-label="Back to conversations"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      <span className="text-xs font-semibold">Chats</span>
                    </Link>
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white">
                      {getInitials(activePeer?.name ?? "LC")}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-slate-900">{activePeer?.name ?? "Conversation"}</p>
                      <p className="truncate text-xs text-slate-500">
                        {activePeer ? `${toStartCase(activePeer.role)} | ${activePeer.email}` : "Leadership chat"}
                      </p>
                    </div>
                  </div>
                </header>

                <div className="flex min-h-0 flex-1 flex-col bg-[linear-gradient(rgba(17,27,33,0.03),rgba(17,27,33,0.03)),radial-gradient(circle_at_20%_20%,rgba(13,90,76,0.05),transparent_35%),radial-gradient(circle_at_80%_80%,rgba(22,163,74,0.05),transparent_40%)]">
                  <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
                    {selectedThread?.messages.map((message) => {
                      const mine = message.senderId === context.userId;
                      return (
                        <div key={message.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                          <div
                            className={cn(
                              "max-w-[92%] rounded-xl px-3 py-2 text-sm shadow-sm sm:max-w-[80%]",
                              mine
                                ? "border border-emerald-200 bg-[#d9fdd3] text-slate-900"
                                : "border border-slate-200 bg-white text-slate-900",
                            )}
                          >
                            {!mine ? <p className="mb-1 text-[11px] font-semibold text-slate-500">{message.sender.name}</p> : null}
                            <p className="whitespace-pre-wrap break-words">{message.content}</p>
                            <p className="mt-1 text-right text-[10px] text-slate-500">{formatConversationTime(message.createdAt)}</p>
                          </div>
                        </div>
                      );
                    })}
                    {selectedThread && selectedThread.messages.length === 0 ? (
                      <p className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-500">
                        Conversation started. Send the first message below.
                      </p>
                    ) : null}
                    {!selectedThread && activePeer ? (
                      <p className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-500">
                        Start your first message with {activePeer.name}.
                      </p>
                    ) : null}
                  </div>

                  <form action={sendChatMessageAction} className="border-t border-slate-200 bg-[#f0f2f5] p-3 sm:p-4">
                    {selectedThread ? <input type="hidden" name="threadId" value={selectedThread.id} /> : null}
                    {!selectedThread && activePeer ? <input type="hidden" name="recipientId" value={activePeer.id} /> : null}
                    <div className="flex items-end gap-2">
                      <textarea
                        name="content"
                        required
                        maxLength={2000}
                        placeholder="Type a message"
                        className="min-h-12 flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                      />
                      <button
                        type="submit"
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={!selectedThread && !activePeer}
                        aria-label="Send message"
                      >
                        <Send className="h-4 w-4" />
                      </button>
                    </div>
                  </form>
                </div>
              </>
            ) : (
              <div className="flex min-h-[75vh] flex-col items-center justify-center px-6 text-center">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <MessageCircle className="h-5 w-5" />
                </span>
                <p className="mt-3 text-base font-semibold text-slate-900">Select a conversation</p>
                <p className="mt-1 max-w-md text-sm text-slate-500">Choose a leadership contact to start chatting.</p>
              </div>
            )}
          </section>
        </div>
      </Card>
    </div>
  );
}
