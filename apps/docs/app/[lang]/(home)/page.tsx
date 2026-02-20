import DynamicLink from "fumadocs-core/dynamic-link";
import type { Metadata } from "next";
import { Installer } from "@/components/geistdocs/installer";
import { Button } from "@/components/ui/button";
import { CenteredSection } from "./components/centered-section";
import { CTA } from "./components/cta";
import { Demo } from "./components/demo";
import { Hero } from "./components/hero";
import { OneTwoSection } from "./components/one-two-section";
import { Templates } from "./components/templates";
import { TextGridSection } from "./components/text-grid-section";
import { Usage } from "./components/usage";

const title = "Chat SDK";
const description =
  "A unified TypeScript SDK for building chat bots across Slack, Microsoft Teams, Google Chat, Discord, and more. Write your bot logic once, deploy everywhere.";

export const metadata: Metadata = {
  title,
  description,
};

const templates = [
  {
    title: "AI Chat Bot",
    description: "Stream LLM responses with the AI SDK and post them to any platform.",
    link: "/docs/guides/ai-chat-bot",
    code: `bot.onNewMention(async (thread) => {
  const result = streamText({
    model: openai("gpt-4o"),
    prompt: thread.messages.at(-1)?.text,
  });

  await thread.streamReply(result.textStream);
});`,
  },
  {
    title: "Thread Subscriptions",
    description: "Subscribe to threads and respond to follow-up messages automatically.",
    link: "/docs/guides/thread-subscriptions",
    code: `bot.onNewMention(async (thread) => {
  await thread.subscribe();
  await thread.post("I'm listening!");
});

bot.onSubscribedMessage(async (thread, msg) => {
  await thread.post(\`Got it: \${msg.text}\`);
});`,
  },
  {
    title: "Multi-Platform Deploy",
    description: "Write once, deploy to Slack, Teams, and Google Chat simultaneously.",
    link: "/docs/guides/multi-platform",
    code: `const bot = new Chat({
  adapters: {
    slack: createSlackAdapter({ ... }),
    teams: createTeamsAdapter({ ... }),
    gchat: createGoogleChatAdapter({ ... }),
  },
  state: createRedisState({ ... }),
});`,
  },
];

const textGridSection = [
  {
    id: "1",
    title: "Multi-platform",
    description:
      "Deploy to Slack, Teams, Google Chat, Discord, GitHub, and Linear from a single codebase.",
  },
  {
    id: "2",
    title: "Type-safe",
    description:
      "Full TypeScript support with type-safe adapters, event handlers, and JSX cards.",
  },
  {
    id: "3",
    title: "AI streaming",
    description:
      "First-class support for streaming LLM responses with native platform rendering.",
  },
];

const HomePage = () => (
  <div className="container mx-auto max-w-5xl">
    <Hero
      badge="Chat SDK is now open source"
      description={description}
      title={title}
    >
      <div className="mx-auto inline-flex w-fit items-center gap-3">
        <Button asChild className="px-4" size="lg">
          <DynamicLink href="/[lang]/docs/getting-started">
            Get Started
          </DynamicLink>
        </Button>
        <Installer command="pnpm add chat" />
      </div>
    </Hero>
    <div className="grid divide-y border-y sm:border-x">
      <CenteredSection
        description="See how your handlers respond to real-time chat events across any platform."
        title="Event-driven by design"
      >
        <Demo />
      </CenteredSection>
      <TextGridSection data={textGridSection} />
      <OneTwoSection
        description="Install the SDK and pair it with your favorite chat providers and state management solutions."
        title="Usage"
      >
        <Usage />
      </OneTwoSection>
      <Templates
        data={templates}
        description="Step-by-step guides to help you build common patterns with the Chat SDK."
        title="Guides"
      />
      <CTA
        cta="Get started"
        href="/docs/getting-started"
        title="Build your first chat bot"
      />
    </div>
  </div>
);

export default HomePage;
