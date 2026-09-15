// Static content for seedDemo.ts. Times are relative to when the seed runs,
// so the data always looks recent.
import { TArticalsCatagory } from "../../modules/articals/articals.interface";
import { TRelation } from "../../modules/friends/friends.interface";
import { TModes } from "../../modules/user/user.interface";

export const DEMO_EMAIL_DOMAIN = "heirloom.demo";
export const DEMO_PASSWORD = "Demo@1234";

export type DemoUserKey =
  | "emma"
  | "james"
  | "olivia"
  | "margaret"
  | "liam"
  | "sophia"
  | "noah"
  | "ava"
  | "ethan"
  | "mia";

type TDemoUser = {
  name: string;
  username: string;
  gender: "male" | "female";
  ageRange: string;
  address: string;
  user_mood: TModes;
  joinedDaysAgo: number;
  note: string;
};

export const demoUsers: Record<DemoUserKey, TDemoUser> = {
  emma: {
    name: "Emma Carter",
    username: "emma_carter",
    gender: "female",
    ageRange: "25–34",
    address: "Portland",
    user_mood: "🤩 Grateful",
    joinedDaysAgo: 60,
    note: "Main tester: family, friends, chats, journals, legacy, assistant",
  },
  james: {
    name: "James Carter",
    username: "james_carter",
    gender: "male",
    ageRange: "55–64",
    address: "Portland",
    user_mood: "😌 Nostalgic",
    joinedDaysAgo: 59,
    note: "Emma's and Olivia's father",
  },
  olivia: {
    name: "Olivia Carter",
    username: "olivia_carter",
    gender: "female",
    ageRange: "18–24",
    address: "Seattle",
    user_mood: "🚀 Motivated",
    joinedDaysAgo: 55,
    note: "Emma's sister",
  },
  margaret: {
    name: "Margaret Carter",
    username: "margaret_carter",
    gender: "female",
    ageRange: "65+",
    address: "Portland",
    user_mood: "😌 Nostalgic",
    joinedDaysAgo: 50,
    note: "Emma's grandmother, no messages yet",
  },
  liam: {
    name: "Liam Brooks",
    username: "liam_brooks",
    gender: "male",
    ageRange: "25–34",
    address: "Denver",
    user_mood: "⚡ Energized",
    joinedDaysAgo: 45,
    note: "Emma's friend",
  },
  sophia: {
    name: "Sophia Nguyen",
    username: "sophia_nguyen",
    gender: "female",
    ageRange: "25–34",
    address: "Austin",
    user_mood: "😌 Calm",
    joinedDaysAgo: 40,
    note: "Emma's friend",
  },
  noah: {
    name: "Noah Patel",
    username: "noah_patel",
    gender: "male",
    ageRange: "25–34",
    address: "Chicago",
    user_mood: "🤷 Curious",
    joinedDaysAgo: 12,
    note: "Pending friend request to Emma",
  },
  ava: {
    name: "Ava Thompson",
    username: "ava_thompson",
    gender: "female",
    ageRange: "18–24",
    address: "Boston",
    user_mood: "😊 Hopeful",
    joinedDaysAgo: 9,
    note: "Pending cousin request to Emma",
  },
  ethan: {
    name: "Ethan Walker",
    username: "ethan_walker",
    gender: "male",
    ageRange: "35–44",
    address: "Phoenix",
    user_mood: "😑 Bored",
    joinedDaysAgo: 5,
    note: "Not connected to Emma, has been reported",
  },
  mia: {
    name: "Mia Rodriguez",
    username: "mia_rodriguez",
    gender: "female",
    ageRange: "35–44",
    address: "Miami",
    user_mood: "💕 Loved",
    joinedDaysAgo: 2,
    note: "Not connected to Emma; pending request to Liam",
  },
};

// `relation` is what `from` is to `to`; `reverse` is what `to` is to `from`.
export const acceptedRelations: {
  from: DemoUserKey;
  to: DemoUserKey;
  relation: TRelation;
  reverse: TRelation;
  daysAgo: number;
}[] = [
  {
    from: "james",
    to: "emma",
    relation: "father",
    reverse: "daughter",
    daysAgo: 58,
  },
  {
    from: "olivia",
    to: "emma",
    relation: "sister",
    reverse: "sister",
    daysAgo: 54,
  },
  {
    from: "james",
    to: "olivia",
    relation: "father",
    reverse: "daughter",
    daysAgo: 52,
  },
  {
    from: "margaret",
    to: "emma",
    relation: "grandmother",
    reverse: "granddaughter",
    daysAgo: 48,
  },
  {
    from: "liam",
    to: "emma",
    relation: "friend",
    reverse: "friend",
    daysAgo: 44,
  },
  {
    from: "emma",
    to: "sophia",
    relation: "friend",
    reverse: "friend",
    daysAgo: 38,
  },
];

export const pendingRelations: {
  from: DemoUserKey;
  to: DemoUserKey;
  relation: TRelation;
  status: "requested" | "rejected";
  daysAgo: number;
}[] = [
  {
    from: "noah",
    to: "emma",
    relation: "friend",
    status: "requested",
    daysAgo: 1,
  },
  {
    from: "ava",
    to: "emma",
    relation: "cousin",
    status: "requested",
    daysAgo: 2,
  },
  {
    from: "mia",
    to: "liam",
    relation: "friend",
    status: "requested",
    daysAgo: 1,
  },
  {
    from: "ethan",
    to: "olivia",
    relation: "friend",
    status: "rejected",
    daysAgo: 4,
  },
];

// One thread per accepted pair at most. The last message is sent `hoursAgo`
// hours ago, earlier ones `gapMinutes` apart. The last `unread` messages are
// left unread by their receiver.
export const threads: {
  between: [DemoUserKey, DemoUserKey];
  hoursAgo: number;
  gapMinutes: number;
  unread: number;
  messages: [DemoUserKey, string][];
}[] = [
  {
    between: ["james", "emma"],
    hoursAgo: 1,
    gapMinutes: 9,
    unread: 2,
    messages: [
      ["emma", "Hi Dad! Did you get home okay after the drive?"],
      [
        "james",
        "Got in around 9. Traffic near Salem was terrible but the audiobook helped",
      ],
      ["emma", "Which one are you listening to now?"],
      [
        "james",
        "The one about the Apollo missions. Your grandpa would have loved it",
      ],
      ["emma", "He really would. Remember his model rocket in the garage?"],
      [
        "james",
        "Still have it in a box somewhere. I'll dig it out this weekend",
      ],
      ["emma", "Please do! I want to take a picture of it for my journal"],
      ["james", "Found it. Nose cone is a little bent but it's all there"],
      ["james", "Come by Sunday and we can make pancakes like old times?"],
    ],
  },
  {
    between: ["olivia", "emma"],
    hoursAgo: 5,
    gapMinutes: 4,
    unread: 0,
    messages: [
      ["olivia", "Emmaaa I got the internship!!"],
      ["emma", "WHAT. Olivia that's amazing, I'm so proud of you"],
      ["olivia", "Starts in June. I'm terrified and excited at the same time"],
      ["emma", "That's exactly how you should feel. You're going to be great"],
      ["olivia", "Can we celebrate when I'm back in Portland?"],
      ["emma", "Obviously. Dinner is on me, you pick the place"],
      ["olivia", "Thai place on Division, the one with the mango sticky rice"],
      ["emma", "Done. I'll book it for Saturday"],
    ],
  },
  {
    between: ["liam", "emma"],
    hoursAgo: 26,
    gapMinutes: 12,
    unread: 1,
    messages: [
      ["liam", "Are we still on for the hike Saturday?"],
      ["emma", "Yes! Is Multnomah Falls too crowded this time of year?"],
      [
        "liam",
        "Probably. What about Angel's Rest instead? Better views anyway",
      ],
      ["emma", "Perfect. I'll bring snacks if you drive"],
      ["liam", "Deal. Picking you up at 7"],
      ["liam", "Bring a rain jacket, forecast says maybe showers"],
    ],
  },
  {
    between: ["emma", "sophia"],
    hoursAgo: 72,
    gapMinutes: 20,
    unread: 0,
    messages: [
      ["emma", "Finished the book you lent me last night"],
      ["sophia", "And?? Did the ending wreck you like it did me"],
      ["emma", "I cried on the bus. Thanks for that"],
      ["sophia", "Ha, sorry not sorry. Book club next Thursday?"],
      ["emma", "I'll be there. Want me to bring anything?"],
      ["sophia", "Just yourself. See you Thursday"],
    ],
  },
  {
    between: ["james", "olivia"],
    hoursAgo: 30,
    gapMinutes: 15,
    unread: 1,
    messages: [
      ["james", "Heard the big news from your sister. Congratulations kiddo"],
      [
        "olivia",
        "Thanks Dad! I wanted to tell you myself but she beat me to it",
      ],
      [
        "james",
        "She was too excited to keep it in. Do you need help finding an apartment?",
      ],
      ["olivia", "Maybe. I'll send you some listings this week"],
      ["james", "Sounds good. Proud of you"],
    ],
  },
];

// Journal titles are globally unique in the schema.
export const journals: {
  user: DemoUserKey;
  title: string;
  daysAgo: number;
  content: string;
}[] = [
  {
    user: "emma",
    title: "Pancakes and the old model rocket",
    daysAgo: 0.2,
    content:
      "Dad found Grandpa's model rocket in the garage today. The nose cone is bent, but holding it brought back every summer afternoon we spent launching it in the field behind the house. I want to write down the countdown Grandpa always did, the way he said 'ignition' with so much drama. Some memories only come back when you touch the thing they belong to.",
  },
  {
    user: "emma",
    title: "Olivia's internship news",
    daysAgo: 1,
    content:
      "Olivia called screaming this morning. She got the internship in Seattle. I'm so proud of her, and a little sad too, because it means she'll be even further away. Booked the Thai place on Division for Saturday so we can celebrate properly.",
  },
  {
    user: "emma",
    title: "Rainy walk and a clear head",
    daysAgo: 4,
    content:
      "Work felt overwhelming all week. I took a long walk in the rain after dinner without my phone and by the time I got home the knot in my chest had loosened. Note to self: walking helps more than scrolling ever does.",
  },
  {
    user: "emma",
    title: "Grandma's apple cake recipe",
    daysAgo: 9,
    content:
      "Grandma Margaret finally let me write down her apple cake recipe. Three apples, a cup of sugar, 'enough' cinnamon, and a splash of the good vanilla. She refused to measure the cinnamon, so I watched her hands and tried to memorize how much she used. I never want to lose this.",
  },
  {
    user: "emma",
    title: "Book club night with Sophia",
    daysAgo: 15,
    content:
      "Sophia's book club picked a novel about two sisters who stop speaking for twenty years. It made me call Olivia on the way home just to hear her voice. We talked for an hour about nothing and it was perfect.",
  },
  {
    user: "emma",
    title: "Starting this journal",
    daysAgo: 58,
    content:
      "First entry. I want a place to keep the small things: what Dad says when he laughs too hard, Grandma's recipes, the hikes with Liam, the way Olivia hums when she cooks. One day I'll want to remember all of it.",
  },
  {
    user: "james",
    title: "The Apollo audiobook",
    daysAgo: 2,
    content:
      "Listening to the Apollo audiobook on the drive home reminded me of my father. He watched the moon landing on a tiny black and white TV and told the story every July. I should tell the girls that story properly before I forget the details.",
  },
  {
    user: "james",
    title: "Garage clean-out",
    daysAgo: 0.5,
    content:
      "Spent the afternoon going through boxes in the garage. Found the model rocket, my old baseball glove and a stack of letters from Margaret. Keeping all three.",
  },
  {
    user: "olivia",
    title: "Internship offer",
    daysAgo: 1,
    content:
      "I got the offer! I read the email four times to make sure it was real. First person I called was Emma, then Dad. Starting in June.",
  },
  {
    user: "olivia",
    title: "Nervous about moving",
    daysAgo: 0.3,
    content:
      "Excited but nervous about moving. New city, new people, no family nearby. I'm going to make a list of things that make any place feel like home.",
  },
];

// Turns are two minutes apart, starting `hoursAgo` hours ago.
export const assistantSessions: {
  user: DemoUserKey;
  hoursAgo: number;
  turns: ["me" | "assistant", string][];
}[] = [
  {
    user: "emma",
    hoursAgo: 80,
    turns: [
      ["me", "I've been feeling overwhelmed with work lately"],
      [
        "assistant",
        "that sounds heavy. is it the amount of work or something about it that's wearing on you",
      ],
      ["me", "Mostly the amount. Too many deadlines at once"],
      [
        "assistant",
        "yeah deadlines piling up is exhausting. anything on the list that could wait a week",
      ],
      ["me", "Maybe the quarterly report. I could ask for an extension"],
      [
        "assistant",
        "that seems worth asking. even one thing off ur plate would help",
      ],
      ["me", "I'll ask tomorrow. Thanks, I feel a bit lighter"],
      ["assistant", "glad. go easy on urself tonight"],
    ],
  },
  {
    user: "emma",
    hoursAgo: 3,
    turns: [
      ["me", "Dad found grandpa's old model rocket today"],
      [
        "assistant",
        "oh wow. the one u used to launch in the field behind the house?",
      ],
      [
        "me",
        "Yes! We're making pancakes on Sunday and I want to bring it back out",
      ],
      [
        "assistant",
        "that's such a good plan. sounds like a day worth writing down",
      ],
    ],
  },
  {
    user: "james",
    hoursAgo: 50,
    turns: [
      ["me", "My daughter got an internship in Seattle"],
      ["assistant", "that's huge. u must be proud"],
      ["me", "Very. A bit worried about her being on her own though"],
      [
        "assistant",
        "makes sense. u could help her find a place, might ease both of u",
      ],
    ],
  },
];

// Negative `triggerInDays` = already delivered (triggerStatus: true).
export const legacies: {
  user: DemoUserKey;
  recipients: DemoUserKey[];
  type: "onetime" | "loop";
  triggerInDays: number;
  createdDaysAgo: number;
  messages: string;
}[] = [
  {
    user: "emma",
    recipients: ["james", "olivia"],
    type: "onetime",
    triggerInDays: 102,
    createdDaysAgo: 20,
    messages:
      "If you're reading this on Christmas morning, I just want you both to know that every good thing in me started at our kitchen table. Thank you for the pancakes, the arguments about board games, and for always leaving the porch light on.",
  },
  {
    user: "emma",
    recipients: ["margaret"],
    type: "loop",
    triggerInDays: 45,
    createdDaysAgo: 10,
    messages:
      "Happy birthday Grandma. Thank you for teaching me the apple cake and for never measuring the cinnamon. I'm still trying to get it right.",
  },
  {
    user: "emma",
    recipients: ["liam", "sophia"],
    type: "onetime",
    triggerInDays: 180,
    createdDaysAgo: 3,
    messages:
      "Ten years of friendship this year. Thank you for the hikes, the book clubs and for showing up every single time. Let's plan something big.",
  },
  {
    user: "margaret",
    recipients: ["emma", "olivia"],
    type: "onetime",
    triggerInDays: -6,
    createdDaysAgo: 40,
    messages:
      "My dear girls, I wrote this down so you'll always have it: be kind to each other, call your father on Sundays, and never skip the cinnamon. I love you more than words.",
  },
  {
    user: "james",
    recipients: ["emma"],
    type: "loop",
    triggerInDays: -30,
    createdDaysAgo: 58,
    messages: "Happy birthday Emma. Every year you make me prouder. Love, Dad.",
  },
  {
    // Next year's copy, as the Bull processor creates for "loop" legacies.
    user: "james",
    recipients: ["emma"],
    type: "loop",
    triggerInDays: 335,
    createdDaysAgo: 30,
    messages: "Happy birthday Emma. Every year you make me prouder. Love, Dad.",
  },
];

export const reports: {
  user: DemoUserKey;
  suspect: DemoUserKey;
  msgTitle: string;
  msg: string;
  isReplyed: boolean;
  daysAgo: number;
}[] = [
  {
    user: "emma",
    suspect: "ethan",
    msgTitle: "Fake profile",
    msg: "This profile looks fake. The name and photo match a public figure and it keeps showing up in my people search.",
    isReplyed: false,
    daysAgo: 1,
  },
  {
    user: "olivia",
    suspect: "ethan",
    msgTitle: "Harassment",
    msg: "I rejected their friend request and they asked a mutual friend for my number. Please take a look.",
    isReplyed: true,
    daysAgo: 3,
  },
];

export const supportRequests: {
  user: DemoUserKey;
  msgTitle: string;
  msg: string;
  daysAgo: number;
}[] = [
  {
    user: "liam",
    msgTitle: "Notifications not arriving",
    msg: "I'm not receiving push notifications when Emma messages me, even though notifications are enabled on my phone.",
    daysAgo: 2,
  },
  {
    user: "sophia",
    msgTitle: "How do I change a relation?",
    msg: "I added Emma as a friend but I'd like to update it. Where can I change the relation?",
    daysAgo: 6,
  },
];

export const contactMessages: {
  name: string;
  emailLocalPart: string;
  phone: string;
  message: string;
  daysAgo: number;
}[] = [
  {
    name: "Daniel Kim",
    emailLocalPart: "daniel.kim",
    phone: "+1 503 555 0142",
    message:
      "Hi, I run a senior living community and would love to know if Heirloom offers group plans for families.",
    daysAgo: 3,
  },
  {
    name: "Priya Shah",
    emailLocalPart: "priya.shah",
    phone: "+1 206 555 0178",
    message:
      "Is there a way to export my journal entries as a PDF? I'd like to print them for my mother.",
    daysAgo: 8,
  },
];

// Matched by exact title on reset, since articles have no owner.
export const articles: {
  titile: string;
  category: TArticalsCatagory;
  content: string;
  daysAgo: number;
}[] = [
  {
    titile: "Writing your first journal entry",
    category: "Beginners",
    daysAgo: 30,
    content:
      "Start small. Pick one moment from today, a conversation, a smell, a song, and write three sentences about it: what happened, how it felt, and why it mattered. Heirloom keeps every entry private to you and uses them to give your companion better context over time. Don't worry about grammar or length. The goal is to capture the detail you'd otherwise forget.",
  },
  {
    titile: "Inviting family and choosing the right relation",
    category: "Beginners",
    daysAgo: 28,
    content:
      "Open People, search for a family member by name or username and send a request with the relation that describes you to them. If you're their mother, choose mother. Once they accept, Heirloom creates the reverse relation for them automatically and opens a private conversation between you. You can update a relation later from your family list.",
  },
  {
    titile: "Legacy messages: saying it at the right moment",
    category: "Advanced",
    daysAgo: 21,
    content:
      "A legacy message is written today and delivered on a date you choose. Use one-time messages for milestones like graduations, and yearly messages for birthdays and anniversaries. Write as if you're speaking directly to the person, mention a specific memory, and keep it short enough to read in a minute. Recipients get a notification when the message is delivered.",
  },
  {
    titile: "How AI Mode replies when you're away",
    category: "Advanced",
    daysAgo: 14,
    content:
      "When you turn on AI Mode in a conversation, Heirloom can reply on your behalf using your recent messages, older conversation summaries and your journal as context. Replies follow the tone of your relationship with that person. You can switch AI Mode off at any time, and you can't send manual messages while it's on.",
  },
  {
    titile: "Five prompts for a reflective evening",
    category: "Tips",
    daysAgo: 7,
    content:
      "1. What made me smile today? 2. Who did I think about, and why? 3. What's one thing I want to remember about this week? 4. What am I carrying that I can put down? 5. What would I tell myself a year from now? Pick one prompt, set a five minute timer and write until it ends.",
  },
  {
    titile: "Keeping family stories alive",
    category: "Tips",
    daysAgo: 3,
    content:
      "Ask one question at every family meal: what was your first job, how did you meet, what did your house smell like growing up. Write the answers in your journal the same night while the details are fresh. Over a year, those small answers become a family history nobody else could write.",
  },
];

export const bookmarks: {
  user: DemoUserKey;
  articleTitle: string;
  daysAgo: number;
}[] = [
  {
    user: "emma",
    articleTitle: "Legacy messages: saying it at the right moment",
    daysAgo: 5,
  },
  {
    user: "emma",
    articleTitle: "Five prompts for a reflective evening",
    daysAgo: 2,
  },
  {
    user: "olivia",
    articleTitle: "Writing your first journal entry",
    daysAgo: 10,
  },
];
