import { Db } from "mongodb";
import { RequestHandler } from "express";
import { busStops, busRoutes, busServices, busServiceRatings } from "./db";

const createGraph = require("ngraph.graph");
const path = require("ngraph.path");

export interface RouteContext {
  db: Db;
}

export type BusGoHomeRoute = (ctx: RouteContext) => RequestHandler;

// This route is included as an example.
export const getBusStop: BusGoHomeRoute =
  ({ db }) =>
  async (req, res) => {
    const { BusStopCode } = req.params;

    const busStop = await busStops(db).findOne(
      { BusStopCode },
      { projection: { _id: 0 } }
    );

    if (!busStop) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    return res.status(200).json(busStop);
  };

function calcCrow(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const lat1C = toRad(lat1);
  const lat2C = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1C) * Math.cos(lat2C);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;
  return d;
}

// Converts numeric degrees to radians
function toRad(value: number) {
  return (value * Math.PI) / 180;
}

export const getBusServiceStops: BusGoHomeRoute =
  ({ db }) =>
  async (req, res) => {
    const { ServiceNo, Direction } = req.params;

    // Task 1: Implement a Route to Get Bus Stops by Service Number
    //         and Direction
    // TODO: Your implementation here.
    const codes = await busRoutes(db)
      .find(
        {
          ServiceNo,
          Direction: Number.parseInt(Direction, 10),
        },
        { projection: { BusStopCode: 1, _id: 0 } }
      )
      .toArray();
    const busStopCodes = codes.map((data) => data.BusStopCode);
    const stops = await busStops(db)
      .find({
        BusStopCode: {
          $in: busStopCodes,
        },
      })
      .toArray();
    if (!stops.length) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Re order wrt to bus route
    stops.sort((a, b) => {
      const idxA = busStopCodes.indexOf(a.BusStopCode);
      const idxB = busStopCodes.indexOf(b.BusStopCode);
      return idxA - idxB;
    });

    // Assuming there will be no duplicate bus stops except the first and last
    if (busStopCodes.length !== stops.length) {
      stops.push({ ...stops[0] });
    }

    res.status(200).json(stops);
  };

export const getNearbyBusStops: BusGoHomeRoute =
  ({ db }) =>
  async (req, res) => {
    const { Latitude, Longitude } = req.params;
    const { maxDistance } = req.query;

    // Task 2: Implement a Route to Find Nearby Bus Stops
    // TODO: Your implementation here.
    const distance = maxDistance ? +maxDistance : 1;
    const LongitudeInt = +Longitude;
    const LatitudeInt = +Latitude;
    const allStops = await busStops(db).find({}).toArray();
    if (!allStops.length) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const stops = allStops.filter((stop) => {
      const [longitude, latitude] = stop.Location.coordinates;
      const dist = Math.abs(
        calcCrow(latitude, longitude, LatitudeInt, LongitudeInt)
      );
      if (dist >= distance) {
        return false;
      }

      return true;
    });
    res.status(200).json(stops);
  };

export const getBusServiceRating: BusGoHomeRoute =
  ({ db }) =>
  async (req, res) => {
    const { ServiceNo, Direction } = req.params;

    // Task 3, Part 1: Implement a Route to Retrieve Rating Statistics
    //                 for a Bus Service
    // TODO: Your implementation here.
    const DirectionInt = +Direction;
    // If no such service
    const service = await busServices(db).findOne({
      ServiceNo,
      Direction: DirectionInt,
    });
    if (!service) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const busStop = await busServiceRatings(db).findOne({
      ServiceNo,
      Direction: DirectionInt,
    });
    if (!busStop) {
      res.status(200).json({
        ServiceNo,
        Direction: DirectionInt,
        AvgRating: 0,
        NumRatings: 0,
      });
      return;
    }

    return res.status(200).json(busStop);
  };

export const submitBusServiceRating: BusGoHomeRoute =
  ({ db }) =>
  async (req, res) => {
    const { ServiceNo, Direction } = req.params;
    const { rating } = req.body;

    // Task 3, Part 2: Implement a Route to Submit a Rating for a Bus Service
    // TODO: Your implementation here.
    const DirectionInt = +Direction;
    // Invalid tatings
    if (!rating || !Number.isInteger(rating) || rating < 0 || rating > 5) {
      res.status(400).json({ error: "Invalid rating" });
      return;
    }
    try {
      // If no such service
      const service = await busServices(db).findOne({
        ServiceNo,
        Direction: DirectionInt,
      });
      if (!service) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const busRating = await busServiceRatings(db).findOne({
        ServiceNo,
        Direction: DirectionInt,
      });

      if (!busRating) {
        await busServiceRatings(db).insertOne({
          ServiceNo,
          Direction: DirectionInt,
          AvgRating: rating,
          NumRatings: 1,
        });
      } else {
        const newAverage =
          (busRating.AvgRating * busRating.NumRatings + rating) /
          (busRating.NumRatings + 1);
        await busServiceRatings(db).updateOne(
          {
            ServiceNo,
            Direction: DirectionInt,
          },
          {
            $set: {
              AvgRating: newAverage,
              NumRatings: busRating.NumRatings + 1,
            },
          }
        );
      }
    } catch {
      res.status(500).json({ error: "Something went wrong" });
      return;
    }
    res.sendStatus(204);
  };

export const getOppositeBusStops: BusGoHomeRoute =
  ({ db }) =>
  async (req, res) => {
    const { RoadName } = req.params;

    // Task 4: Implement a Route to List Pairs of Opposite Bus Stops

    const stops = await busStops(db)
      .aggregate([
        // Filter by RoadName
        {
          $match: {
            RoadName,
          },
        },
        {
          $addFields: {
            lastDigit: { $substr: ["$BusStopCode", 4, 5] },
          },
        },
        {
          $addFields: {
            identifier: {
              $cond: {
                if: { $in: ["$lastDigit", ["1", "9"]] },
                then: { $substr: ["$BusStopCode", 0, 4] },
                else: "$BusStopCode",
              },
            },
          },
        },
        // Group pairs together and single stops alone
        {
          $group: {
            _id: "$identifier",
            records: {
              $push: "$$ROOT",
            },
            bigBoy: {
              $max: "$BusStopCode",
            },
          },
        },
        // To sort documents in ascending order by BusStopCode
        { $unwind: "$records" },
        { $sort: { "records.BusStopCode": -1 } },
        // Regroup by their identifiers in sorted order
        {
          $group: {
            _id: "$_id",
            records: { $push: "$records" },
            bigBoy: { $first: "$bigBoy" },
          },
        },
        // Sort the grouped documents by BusStopCode
        { $sort: { bigBoy: 1 } },
        { $unwind: "$records" },
        { $replaceRoot: { newRoot: "$records" } },
        {
          $project: {
            _id: 0,
            identifier: 0,
            bigBoy: 0,
          },
        },
      ])
      .toArray();

    if (stops.length < 1) return res.status(404).json({ error: "Not found" });

    res.status(200).json(stops);
  };

export const getJourney: BusGoHomeRoute =
  ({ db }) =>
  async (req, res) => {
    const { OriginStopCode, DestinationStopCode } = req.params;

    // Task 5: Implement a Route to Find a Path Between Two Bus Stops
    // TODO: Your implementation here

    const data = await busRoutes(db)
      .aggregate([
        {
          $addFields: {
            busRoute: {
              $concat: [
                { $toString: "$ServiceNo" },
                { $toString: "$Direction" },
              ],
            },
          },
        },
        {
          $lookup: {
            from: "busStops",
            localField: "BusStopCode",
            foreignField: "BusStopCode",
            as: "details",
          },
        },
        { $unwind: "$details" },
        {
          $addFields: {
            "details.order": "$StopSequence",
          },
        },
        {
          $group: {
            _id: "$busRoute",
            routes: {
              $push: "$details",
            },
          },
        },
      ])
      .toArray();

    const g = createGraph();
    data.forEach((route) => {
      const { routes } = route;
      for (let i = 0; i < routes.length - 1; i += 1) {
        const currentStop = routes[i].BusStopCode;
        if (!g.getNode(currentStop)) {
          g.addNode(currentStop);
        }

        if (i + 1 < routes.length) {
          const nextStop = routes[i + 1].BusStopCode;
          if (!g.getNode(nextStop)) {
            g.addNode(nextStop);
          }
          // TODO: Add weights to edges
          // TODO: Add different states for different directions to account for transfer time
          g.addLink(currentStop, nextStop);
        }
      }
    });

    const pathFinder = path.aStar(g);
    const foundPath = pathFinder.find(OriginStopCode, DestinationStopCode);
    if (!foundPath.length) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(200).json(foundPath);
  };
