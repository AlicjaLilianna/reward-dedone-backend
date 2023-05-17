import { ApolloServer } from '@apollo/server';

import { startStandaloneServer } from '@apollo/server/standalone';
import { GraphQLError } from 'graphql';
import jwt from 'jsonwebtoken';
import 'dotenv/config'
import { MongoClient } from "mongodb";

const JWT_SECRET = process.env.JWT_SECRET;
const DEPLOYMENT = process.env.DEPLOYMENT;
const APP_PORT = process.env.PORT as unknown as number;
const MONGO_URI = process.env.MONGODB_URI;

const client = new MongoClient(MONGO_URI);
const db = client.db("task_db");

const books = [
  {
    title: 'The Awakening',
    author: 'Kate Chopin',
  },
  {
    title: 'City of Glass',
    author: 'Paul Auster',
  },

];

// A schema is a collection of type definitions (hence "typeDefs")
// that together define the "shape" of queries that are executed against
// your data.

const typeDefs = `#graphql
  # Comments in GraphQL strings (such as this one) start with the hash (#) symbol.
  # This "Book" type defines the queryable fields for every book in our data source.

  type Book {
    title: String
    author: String
  }

  type TaskInstance {
    done: Boolean
    title: String
    id: ID!
  }

  type SuccessResponse {
    message: String
    success: Boolean!
  }

  type Mutation {
		addTask(title: String!): SuccessResponse 
	}

  # The "Query" type is special: it lists all of the available queries that
  # clients can execute, along with the return type for each. In this
  # case, the "books" query returns an array of zero or more Books (defined above).
  type Query {
    books: [Book]
    taskInstances: [TaskInstance]
    tasks: [TaskInstance]
  }`

const resolvers = {
  Query: {
    books: () => books,
    tasks: async () => (await db.collection("tasks").find().toArray()).map(_ => { return { ..._, id: _._id } }),
  },
  Mutation: {
    addTask: async (_, { title }) => {
      const tasks = db.collection("tasks");
      const doc = {
        title,
      };
      try {
        const result = await tasks.insertOne(doc);
      } catch {
        return {
          success: false,
          message: 'failed adding a task',
        };

      }
      return {
        success: true,
        message: 'task',
        task: [tasks],
      };
    }
  }
};


// The ApolloServer constructor requires two parameters: your schema

// definition and your set of resolvers.

const server = new ApolloServer({
  typeDefs,
  resolvers,
});

const getUser = token => {
  if (DEPLOYMENT === 'development') {
    return process.env.USER;;
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

    return { user };
  }
});