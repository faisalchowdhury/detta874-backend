/**
 * Demo data seeder for manual testing.
 *
 *   npm run seed:demo        -> removes any previous demo data, then inserts a fresh set
 *   npm run seed:demo:reset  -> removes demo data only
 *
 * Every demo user has an @heirloom.demo email. All other demo records either
 * belong to / point at one of those users, or are matched by the exact
 * article titles and emails defined in demoData.ts, so a reset never removes
 * anything else.
 *
 * Only MongoDB is seeded. Nothing is written to Pinecone, Redis or the Bull
 * queue, so AI replies won't recall demo journals and demo legacy messages are
 * never actually triggered.
 */
import dns from "dns";
import mongoose, { Model, Types } from "mongoose";
import { DATABASE_URL } from "../../config";
import { hashPassword } from "../../modules/user/user.utils";
import { OTPModel, UserModel } from "../../modules/user/user.model";
import { Friends } from "../../modules/friends/friends.model";
import { Conversations, Messages } from "../../modules/messages/messages.model";
import { JournalsDB } from "../../modules/journals/journals.model";
import { Legacys } from "../../modules/legacy/legacy.model";
import { AssistantChats } from "../../modules/Assistant/assistantChat.model";
import { NotificationModel } from "../../modules/notifications/notification.model";
import reportModel from "../../modules/report/report.model";
import supportModel from "../../modules/support/support.model";
import contactUs from "../../modules/contactUs/contactUs.model";
import { ArticalsModel } from "../../modules/articals/articals.model";
import BookMark from "../../modules/BookMark/BookMark.model";
import {
  acceptedRelations,
  articles,
  assistantSessions,
  bookmarks,
  contactMessages,
  DEMO_EMAIL_DOMAIN,
  DEMO_PASSWORD,
  DemoUserKey,
  demoUsers,
  journals,
  legacies,
  pendingRelations,
  reports,
  supportRequests,
  threads,
} from "./demoData";

// Atlas SRV lookups fail on some local resolvers; server.ts does the same.
dns.setServers(["1.1.1.1", "1.0.0.1"]);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const now = Date.now();
const hoursAgo = (hours: number) => new Date(now - hours * HOUR);
const daysAgo = (days: number) => new Date(now - days * DAY);

const DEMO_EMAIL_REGEX = new RegExp(
  `@${DEMO_EMAIL_DOMAIN.replace(/\./g, "\\.")}$`,
  "i",
);
const demoEmail = (localPart: string) => `${localPart}@${DEMO_EMAIL_DOMAIN}`;
const userEmail = (key: DemoUserKey) =>
  demoEmail(demoUsers[key].username.replace(/_/g, "."));

// Mongoose overwrites createdAt/updatedAt on save, so validate through the
// model and insert through the driver to keep the backdated timestamps.
const insertBackdated = async (
  model: Model<any>,
  docs: Record<string, unknown>[],
) => {
  if (!docs.length) return 0;
  const built = docs.map((doc) => new model(doc));
  await Promise.all(built.map((doc) => doc.validate()));
  const result = await model.collection.insertMany(
    built.map((doc) => doc.toObject()),
  );
  return result.insertedCount;
};

const removeDemoData = async () => {
  const users = await UserModel.find({ email: DEMO_EMAIL_REGEX })
    .select("_id")
    .lean();
  const ids = users.map((user: any) => user._id as Types.ObjectId);
  const titles = articles.map((article) => article.titile);
  const demoArticles = await ArticalsModel.find({ titile: { $in: titles } })
    .select("_id")
    .lean();
  const articleIds = demoArticles.map((article) => article._id);

  const [
    messages,
    conversations,
    friends,
    journalCount,
    legacyCount,
    assistantChats,
    notifications,
    reportCount,
    supports,
    contacts,
    bookmarkCount,
    articleCount,
    otps,
  ] = await Promise.all([
    Messages.deleteMany({
      $or: [{ sender: { $in: ids } }, { reciver: { $in: ids } }],
    }),
    Conversations.deleteMany({ participants: { $in: ids } }),
    Friends.deleteMany({
      $or: [{ sendBy: { $in: ids } }, { reciveBy: { $in: ids } }],
    }),
    JournalsDB.deleteMany({ user: { $in: ids } }),
    Legacys.deleteMany({ user: { $in: ids } }),
    AssistantChats.deleteMany({ user: { $in: ids } }),
    NotificationModel.deleteMany({ userId: { $in: ids } }),
    reportModel.deleteMany({
      $or: [{ user: { $in: ids } }, { suspect: { $in: ids } }],
    }),
    supportModel.deleteMany({ email: DEMO_EMAIL_REGEX }),
    contactUs.deleteMany({ email: DEMO_EMAIL_REGEX }),
    BookMark.deleteMany({
      $or: [{ userId: { $in: ids } }, { articalsId: { $in: articleIds } }],
    }),
    ArticalsModel.deleteMany({ _id: { $in: articleIds } }),
    OTPModel.deleteMany({ email: DEMO_EMAIL_REGEX }),
  ]);
  const userCount = await UserModel.deleteMany({ _id: { $in: ids } });

  return {
    users: userCount.deletedCount,
    friends: friends.deletedCount,
    conversations: conversations.deletedCount,
    messages: messages.deletedCount,
    journals: journalCount.deletedCount,
    assistantchats: assistantChats.deletedCount,
    legacys: legacyCount.deletedCount,
    notifications: notifications.deletedCount,
    reports: reportCount.deletedCount,
    supports: supports.deletedCount,
    contactus: contacts.deletedCount,
    articals: articleCount.deletedCount,
    bookmarks: bookmarkCount.deletedCount,
    otps: otps.deletedCount,
  };
};

// Runs after removeDemoData, so anything found here belongs to real data.
const assertNoConflicts = async () => {
  const usernames = Object.values(demoUsers).map((user) => user.username);
  const [takenUsernames, takenTitles] = await Promise.all([
    UserModel.find({ username: { $in: usernames } })
      .select("username")
      .lean(),
    JournalsDB.find({ title: { $in: journals.map((j) => j.title) } })
      .select("title")
      .lean(),
  ]);
  const problems = [
    ...takenUsernames.map(
      (user: any) => `username "${user.username}" is used by a real account`,
    ),
    ...takenTitles.map(
      (journal) => `journal title "${journal.title}" already exists`,
    ),
  ];
  if (problems.length) {
    throw new Error(
      `Demo data conflicts with existing records:\n  - ${problems.join("\n  - ")}`,
    );
  }
};

const seedDemoData = async () => {
  const keys = Object.keys(demoUsers) as DemoUserKey[];
  const userIds = Object.fromEntries(
    keys.map((key) => [key, new Types.ObjectId()]),
  ) as Record<DemoUserKey, Types.ObjectId>;
  const id = (key: DemoUserKey) => userIds[key];

  const admins = await UserModel.find({ role: "admin", isDeleted: false })
    .select("_id")
    .lean();
  const adminIds = admins.map((admin: any) => admin._id as Types.ObjectId);

  // ---------------- users ----------------
  const userDocs = await Promise.all(
    keys.map(async (key) => {
      const { name, username, gender, ageRange, address, user_mood } =
        demoUsers[key];
      const joinedAt = daysAgo(demoUsers[key].joinedDaysAgo);
      return {
        _id: id(key),
        name,
        username,
        gender,
        ageRange,
        address,
        user_mood,
        email: userEmail(key),
        password: await hashPassword(DEMO_PASSWORD),
        role: "user",
        isVerified: true,
        profile_status: true,
        activeStatus: false,
        createdAt: joinedAt,
        updatedAt: joinedAt,
      };
    }),
  );

  // ---------------- friends ----------------
  // Accepting a request in the app leaves two accepted rows: the original
  // (sender's role towards the receiver) and a mirrored one created by the
  // receiver with the reciprocal relation (see FriendControllers.action).
  const friendDocs = [
    ...acceptedRelations.flatMap(
      ({ from, to, relation, reverse, daysAgo: age }) => [
        {
          sendBy: id(from),
          reciveBy: id(to),
          relation,
          status: "accepted",
          createdAt: daysAgo(age),
          updatedAt: daysAgo(age),
        },
        {
          sendBy: id(to),
          reciveBy: id(from),
          relation: reverse,
          status: "accepted",
          createdAt: daysAgo(age),
          updatedAt: daysAgo(age),
        },
      ],
    ),
    ...pendingRelations.map(({ from, to, relation, status, daysAgo: age }) => ({
      sendBy: id(from),
      reciveBy: id(to),
      relation,
      status,
      createdAt: daysAgo(age),
      updatedAt: daysAgo(age),
    })),
  ];

  // ---------------- conversations + messages ----------------
  const isPair = (
    a: DemoUserKey,
    b: DemoUserKey,
    x: DemoUserKey,
    y: DemoUserKey,
  ) => (a === x && b === y) || (a === y && b === x);

  for (const thread of threads) {
    const [a, b] = thread.between;
    if (!acceptedRelations.some(({ from, to }) => isPair(from, to, a, b))) {
      throw new Error(`Thread ${a} <-> ${b} has no accepted relation`);
    }
  }

  const conversationDocs: Record<string, unknown>[] = [];
  const messageDocs: Record<string, unknown>[] = [];
  for (const { from, to, daysAgo: age } of acceptedRelations) {
    const conversationId = new Types.ObjectId();
    const startedAt = daysAgo(age);
    let lastMessage: Types.ObjectId | null = null;
    let lastActivity = startedAt;

    const thread = threads.find(({ between: [a, b] }) =>
      isPair(from, to, a, b),
    );
    if (thread) {
      const [a, b] = thread.between;
      const count = thread.messages.length;
      const lastSentAt = hoursAgo(thread.hoursAgo).getTime();
      thread.messages.forEach(([sender, text], index) => {
        const receiver = sender === a ? b : a;
        const sentAt = new Date(
          lastSentAt - (count - 1 - index) * thread.gapMinutes * MINUTE,
        );
        const isUnread = index >= count - thread.unread;
        const messageId = new Types.ObjectId();
        messageDocs.push({
          _id: messageId,
          conversation: conversationId,
          sender: id(sender),
          reciver: id(receiver),
          messages: text,
          readBy: isUnread ? [id(sender)] : [id(sender), id(receiver)],
          createdAt: sentAt,
          updatedAt: sentAt,
        });
        lastMessage = messageId;
        lastActivity = sentAt;
      });
    }

    conversationDocs.push({
      _id: conversationId,
      participants: [id(from), id(to)],
      lastMessage,
      ai_user: [],
      createdAt: startedAt,
      updatedAt: lastActivity,
    });
  }

  // ---------------- journals ----------------
  const journalDocs = journals.map(
    ({ user, title, content, daysAgo: age }) => ({
      user: id(user),
      title,
      content,
      customDate: daysAgo(age),
      isDeleted: false,
      createdAt: daysAgo(age),
      updatedAt: daysAgo(age),
    }),
  );

  // ---------------- assistant chats ----------------
  const assistantDocs = assistantSessions.flatMap(
    ({ user, hoursAgo: startedHoursAgo, turns }) =>
      turns.map(([type, message], index) => {
        const at = new Date(
          hoursAgo(startedHoursAgo).getTime() + index * 2 * MINUTE,
        );
        return { user: id(user), type, message, createdAt: at, updatedAt: at };
      }),
  );

  // ---------------- legacy messages ----------------
  const legacyDocs = legacies.map(
    ({ user, recipients, type, triggerInDays, createdDaysAgo, messages }) => {
      const triggerDate = new Date(now + triggerInDays * DAY);
      const triggered = triggerInDays < 0;
      return {
        user: id(user),
        recipients: recipients.map((recipient) => id(recipient)),
        messages,
        type,
        triggerDate,
        triggerStatus: triggered,
        isDeleted: false,
        createdAt: daysAgo(createdDaysAgo),
        updatedAt: triggered ? triggerDate : daysAgo(createdDaysAgo),
      };
    },
  );

  // ---------------- notifications ----------------
  // Message texts mirror what the app itself emits (registerUser, the legacy
  // Bull processor and the report/support controllers).
  const supportUserMsg =
    "📬 Thank you for reaching out! 💡 Our support team has received your message and will get back to you shortly. 🚀";
  const supportAdminMsg = (key: DemoUserKey) =>
    `🔔 **Support Request Alert!** 🌟 A user has requested support:👤Name: ${demoUsers[key].name} ✉️ Email: ${userEmail(key)} `;

  const notificationDocs = [
    ...keys.map((key) => {
      const { name, joinedDaysAgo } = demoUsers[key];
      return {
        userId: id(key),
        userMsg: `💫 Welcome to Bienvenue, ${name}! 🎉 Your registration is complete, and we're thrilled to have you onboard. Start exploring and enjoy the experience! 🚀`,
        adminId: adminIds,
        adminMsg: `📢 New user registration! 🎉 A new user, ${name}, has successfully registered with Bienvenue. Please welcome them aboard and ensure everything is set up for their journey.`,
        isUserRead: true,
        isAdminRead: joinedDaysAgo > 7,
        createdAt: daysAgo(joinedDaysAgo),
        updatedAt: daysAgo(joinedDaysAgo),
      };
    }),
    ...legacies
      .filter(({ triggerInDays }) => triggerInDays < 0)
      .flatMap(({ user, recipients, messages, triggerInDays }) =>
        recipients.map((recipient) => ({
          userId: id(recipient),
          userMsg: `Hey there! This message is from ${demoUsers[user].name}, and here's what they said: \n${messages}`,
          adminId: adminIds,
          adminMsg: "Someone recevied lagacy update.",
          isUserRead: triggerInDays < -14,
          isAdminRead: true,
          createdAt: new Date(now + triggerInDays * DAY),
          updatedAt: new Date(now + triggerInDays * DAY),
        })),
      ),
    ...[...reports, ...supportRequests].map(({ user, daysAgo: age }) => ({
      userId: id(user),
      userMsg: supportUserMsg,
      adminId: adminIds,
      adminMsg: supportAdminMsg(user),
      isUserRead: age > 3,
      isAdminRead: age > 3,
      createdAt: daysAgo(age),
      updatedAt: daysAgo(age),
    })),
  ];

  // ---------------- reports / support / contact us ----------------
  const reportDocs = reports.map(
    ({ user, suspect, msgTitle, msg, isReplyed, daysAgo: age }) => ({
      user: id(user),
      suspect: id(suspect),
      msgTitle,
      msg,
      isReplyed,
      isDeleted: false,
      createdAt: daysAgo(age),
      updatedAt: daysAgo(age),
    }),
  );
  const supportDocs = supportRequests.map(
    ({ user, msgTitle, msg, daysAgo: age }) => ({
      name: demoUsers[user].name,
      email: userEmail(user),
      msgTitle,
      msg,
      isDeleted: false,
      createdAt: daysAgo(age),
      updatedAt: daysAgo(age),
    }),
  );
  const contactDocs = contactMessages.map(
    ({ name, emailLocalPart, phone, message, daysAgo: age }) => ({
      name,
      email: demoEmail(emailLocalPart),
      phone,
      message,
      isDeleted: false,
      createdAt: daysAgo(age),
      updatedAt: daysAgo(age),
    }),
  );

  // ---------------- articles + bookmarks ----------------
  const articleIds = new Map<string, Types.ObjectId>();
  const articleDocs = articles.map(
    ({ titile, category, content, daysAgo: age }) => {
      const articleId = new Types.ObjectId();
      articleIds.set(titile, articleId);
      return {
        _id: articleId,
        titile,
        category,
        content,
        createdAt: daysAgo(age),
        updatedAt: daysAgo(age),
      };
    },
  );
  const bookmarkDocs = bookmarks.map(({ user, articleTitle, daysAgo: age }) => {
    const articleId = articleIds.get(articleTitle);
    if (!articleId)
      throw new Error(`Bookmark points at unknown article "${articleTitle}"`);
    return {
      userId: id(user),
      articalsId: articleId,
      isDeleted: false,
      createdAt: daysAgo(age),
      updatedAt: daysAgo(age),
    };
  });

  // Users first so a failure elsewhere still leaves data the reset can find.
  const users = await insertBackdated(UserModel, userDocs);
  const [
    friends,
    conversations,
    messages,
    journalCount,
    assistantchats,
    legacys,
    notifications,
    reportCount,
    supports,
    contactus,
    articals,
  ] = await Promise.all([
    insertBackdated(Friends, friendDocs),
    insertBackdated(Conversations, conversationDocs),
    insertBackdated(Messages, messageDocs),
    insertBackdated(JournalsDB, journalDocs),
    insertBackdated(AssistantChats, assistantDocs),
    insertBackdated(Legacys, legacyDocs),
    insertBackdated(NotificationModel, notificationDocs),
    insertBackdated(reportModel, reportDocs),
    insertBackdated(supportModel, supportDocs),
    insertBackdated(contactUs, contactDocs),
    insertBackdated(ArticalsModel, articleDocs),
  ]);
  const bookmarkCount = await insertBackdated(BookMark, bookmarkDocs);

  return {
    users,
    friends,
    conversations,
    messages,
    journals: journalCount,
    assistantchats,
    legacys,
    notifications,
    reports: reportCount,
    supports,
    contactus,
    articals,
    bookmarks: bookmarkCount,
  };
};

const printLogins = () => {
  console.log(`\nDemo logins (password for all: ${DEMO_PASSWORD})`);
  console.table(
    (Object.keys(demoUsers) as DemoUserKey[]).map((key) => ({
      name: demoUsers[key].name,
      email: userEmail(key),
      gender: demoUsers[key].gender,
      note: demoUsers[key].note,
    })),
  );
};

const main = async () => {
  const resetOnly = process.argv.includes("--reset");

  await mongoose.connect(DATABASE_URL as string, {
    serverSelectionTimeoutMS: 20000,
  });
  console.log(`Connected to database "${mongoose.connection.name}"`);

  console.log("\nRemoved existing demo data:");
  console.table(await removeDemoData());
  if (resetOnly) return;

  await assertNoConflicts();
  try {
    console.log("\nInserted demo data:");
    console.table(await seedDemoData());
  } catch (error) {
    console.error(
      "\nSeeding stopped part-way. Run `npm run seed:demo:reset` to clean up.",
    );
    throw error;
  }
  printLogins();
};

main()
  .catch((error) => {
    console.error("Demo seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
