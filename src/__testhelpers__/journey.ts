import { Db } from "mongodb";
import { busRoutes } from "../db";

export interface JourneySegment {
  ServiceNo: string;
  Direction: number;
  OriginCode: string;
  DestinationCode: string;
}

export interface Journey {
  segments: JourneySegment[];
  estimatedTime: number;
}

const segmentToStr = (segment: JourneySegment): string => {
  const { ServiceNo, Direction, OriginCode, DestinationCode } = segment;

  return `${ServiceNo}-${Direction}, ${OriginCode} to ${DestinationCode}`;
};

const validateSegmentAndGetEstimatedTime = async (
  db: Db,
  origin: string,
  segment: JourneySegment
): Promise<number> => {
  const { ServiceNo, Direction, OriginCode, DestinationCode } = segment;

  if (OriginCode !== origin)
    throw new Error(
      `In segment ${segmentToStr(segment)}: Expected OriginCode to be ${origin}`
    );

  // To handle looping routes where we are returning to the
  // destination, we always select the _last_ two bus stops in the
  // route matching the origin or destination bus stop codes.
  const routes = await (
    await busRoutes(db)
      .find({
        ServiceNo,
        Direction,
        BusStopCode: { $in: [OriginCode, DestinationCode] },
      })
      .sort({ StopSequence: -1 })
      .limit(2)
      .toArray()
  ).reverse();

  if (routes.length < 2)
    throw new Error(
      `In segment ${segmentToStr(
        segment
      )}: One or both bus stops not in this service's route, or the route does not exist`
    );

  const [originStop, destinationStop] = routes;

  if (originStop.BusStopCode !== OriginCode)
    throw new Error(
      `In segment ${segmentToStr(
        segment
      )}: Bus stop ${OriginCode} does not come before ${DestinationCode} in this service's route`
    );

  const distance = destinationStop.Distance - originStop.Distance;

  return (distance / 20) * 60;
};

export const throwIfJourneyInvalid = async (
  db: Db,
  origin: string,
  destination: string,
  journey: Journey
) => {
  const { segments, estimatedTime } = journey;

  if (segments.length < 1)
    throw new Error("Journey does not have at least one segment");

  const firstSegment = segments[0];
  const lastSegment = segments[segments.length - 1];

  if (firstSegment.OriginCode !== origin)
    throw new Error(
      `In segment: ${segmentToStr(
        firstSegment
      )}: OriginCode of the first segment is not ${origin}`
    );

  if (lastSegment.DestinationCode !== destination)
    throw new Error(
      `In segment: ${segmentToStr(
        lastSegment
      )}: DestinationCode of the last segment is not ${destination}`
    );

  const estimatedSegmentTimes = await Promise.all(
    segments.map((segment, idx) => {
      const expectedOrigin =
        idx > 0 ? segments[idx - 1].DestinationCode : origin;

      return validateSegmentAndGetEstimatedTime(db, expectedOrigin, segment);
    })
  );

  const expectedEstimatedTime =
    estimatedSegmentTimes.reduce(
      (totalTime, segmentTime) => totalTime + segmentTime,
      0
    ) +
    (segments.length - 1) * 10;

  if (estimatedTime !== expectedEstimatedTime)
    throw new Error(
      `Expected estimated time for the given journey to be ${expectedEstimatedTime}, but received ${estimatedTime} instead`
    );
};
