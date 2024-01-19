import { ApolloServer } from '@apollo/server';

import { startStandaloneServer } from '@apollo/server/standalone';
import { GraphQLError } from 'graphql';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { MongoClient, ObjectId } from "mongodb";

const JWT_SECRET = process.env.JWT_SECRET;
const DEPLOYMENT = process.env.DEPLOYMENT;
const APP_PORT = process.env.PORT as unknown as number;
const MONGO_URI = process.env.MONGODB_URI;

const client = new MongoClient(MONGO_URI);
const db = client.db("task_db");

// A schema is a collection of type definitions (hence "typeDefs")
// that together define the "shape" of queries that are executed against
// your data.

const typeDefs = `#graphql
  # Comments in GraphQL strings (such as this one) start with the hash (#) symbol.
  type Task {
    done: Boolean
    title: String!
    id: ID!
    points: Int!
    importance: Importance!
  }

  type UserInfo {
    points: Int!
    profilePicture: String
  }

  type SuccessResponse {
    message: String
    success: Boolean!
  }

  enum Importance {
    low,
    normal,
    high,
    uber_high
  }

  type Mutation {
		addTask(title: String!, points: Int!, importance: Importance): SuccessResponse 
    deleteTask(id: ID!): SuccessResponse
    editTask(id: ID!, title: String, points: Int, importance: Importance): SuccessResponse
    completeTask(id: ID!): SuccessResponse
    addReward(title: String!, points: Int!): SuccessResponse
    deleteReward(id: ID!): SuccessResponse
    editReward(id: ID!, title: String, points: Int): SuccessResponse
    buyReward(id: ID!): SuccessResponse
	}

  type Reward {
    id: ID!
    title: String!
    points: Int!
  }

  type Query {
    tasks: [Task]
    rewards: [Reward]
    user_info: UserInfo
  }`

const resolvers = {
  Query: {
    tasks: async () => (await db.collection("tasks").find().toArray()).map(_ => { return { ..._, id: new ObjectId(_._id) } }),
    rewards: async () => (await db.collection("rewards").find().toArray()).map(_ => { return { ..._, id: new ObjectId(_._id) } }),
    user_info: async (_,__,context) => (await db.collection("user").findOne({_id: new ObjectId(context.user_id)})),
  },
  Mutation: {
    deleteTask: async (_, { id }) => { await db.collection("tasks").deleteOne({ _id: new ObjectId(id) }) },
    editTask: async (_, args) => { const { id, ...rest } = args; await db.collection("tasks").updateOne({ _id: new ObjectId(id) }, { $set: rest }) },
    completeTask: async (_, { id }, context) => {
      await db.collection("tasks").updateOne({ _id: new ObjectId(id) }, { $set: { done: true } })
      const user_info = await db.collection("user").findOne({ _id: new ObjectId(context.user_id) });
      const task = await db.collection("tasks").findOne({ _id: new ObjectId(id) });
      const cur_points = user_info.points ?? 0;
      await db.collection("user").updateOne({ _id: new ObjectId(context.user_id) }, { $set: { points: cur_points + task.points } });
      return {
        success: true,
        message: 'task completed',
      };

    },
    addReward: async (_, args) => {
      const rewards = db.collection("rewards");
      const result = await rewards.insertOne(args);
      return {
        success: true,
        message: 'added a reward',
      };

    },
    deleteReward: async (_, { id }) => { await db.collection("rewards").deleteOne({ _id: new ObjectId(id) }) },
    editReward: async (_, args) => { const { id, ...rest } = args; await db.collection("rewards").updateOne({ _id: new ObjectId(id) }, { $set: rest }) },
    buyReward: async (_, { id }, context) => {
      const user_info = await db.collection("user").findOne({ _id: new ObjectId(context.user_id) });
      const reward = await db.collection("rewards").findOne({ _id: new ObjectId(id) });
      if (user_info.points >= reward.points) {
        await db.collection("user").updateOne({ _id: new ObjectId(context.user_id) }, { $set: { points: user_info.points - reward.points } });
        return {
          success: true,
          message: 'bought a reward',
        };
      } else {
        return {
          success: false,
          message: 'not enough points to buy reward',
        };
      }
    },
    addTask: async (_, args) => {
      const tasks = db.collection("tasks");
      const result = await tasks.insertOne({...args, done: false});
      return {
        success: true,
        message: 'task',
        task: [tasks]
      };
    }
  }
};


// The ApolloServer constructor requires two parameters: your schema

// definition and your set of resolvers.

const server = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: true,
});

const getUser = token => {
  if (DEPLOYMENT === 'development') {
    return { email: process.env.USER };
  }
  try {
    if (token) {
      return jwt.verify(token, JWT_SECRET)
    }
    return null
  } catch (error) {
    return null
  }
}


startStandaloneServer(server, {
  listen: { port: APP_PORT },
  context: async ({ req }) => {

    const token = req.headers.authorization || '';
    const user = getUser(token);
    if (!user)
      throw new GraphQLError('User is not authenticated', {
        extensions: {
          code: 'UNAUTHENTICATED',
          http: { status: 401 },
        },
      });

    const mail = user.email;
    if (!mail) {
      throw new GraphQLError('User is not authenticated', {
        extensions: {
          code: 'UNAUTHENTICATED',
          http: { status: 401 },
        },
      });
    }

    const db_user = await db.collection("user").findOne({ email: mail });
    let db_user_id = null;
    if (!db_user) {
      const { insertedId: _id } = await db.collection("user").insertOne({ email: mail, points: 0 });
      db_user_id = _id;
    } else {
      db_user_id = db_user._id
    }
    return { user, user_id: db_user_id };
  }
});
