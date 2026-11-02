/**
 * Raw shapes returned by the Trafikinfo API (JSON, v2 endpoint).
 * Every field is optional: the API omits fields that have no value.
 *
 * Field names follow Trafikverket's published XSD schemas (TrainAnnouncement 2.0, OperativeEvent 1.0, RailwayEvent 1.0,
 * TrainStation 1.5, Situation 1.6, WeatherObservation 2.1, TrainPosition 1.1,
 * ReplacementTraffic 1.0).
 */

export interface RawGeometry {
  SWEREF99TM?: string;
  WGS84?: string;
}

export interface RawMeasured {
  Value?: number;
  Origin?: string;
}

export interface RawCodeDescription {
  Code?: string;
  Description?: string;
}

export interface RawLocationRef {
  LocationName?: string;
  Priority?: number;
  Order?: number;
}

export interface RawStation {
  LocationSignature?: string;
  AdvertisedLocationName?: string;
  AdvertisedShortLocationName?: string;
  OfficialLocationName?: string;
  CountyNo?: number[];
  Geometry?: RawGeometry;
}

export interface RawTrainAnnouncement {
  ActivityType?: string;
  Advertised?: boolean;
  AdvertisedTimeAtLocation?: string;
  AdvertisedTrainIdent?: string;
  Canceled?: boolean;
  Deviation?: RawCodeDescription[];
  EstimatedTimeAtLocation?: string;
  EstimatedTimeIsPreliminary?: boolean;
  FromLocation?: RawLocationRef[];
  InformationOwner?: string;
  LocationSignature?: string;
  Operator?: string;
  OtherInformation?: RawCodeDescription[];
  ProductInformation?: RawCodeDescription[];
  TimeAtLocation?: string;
  ToLocation?: RawLocationRef[];
  TrackAtLocation?: string;
  TypeOfTraffic?: RawCodeDescription[];
}

export interface RawEventLocation {
  Signature?: string;
  LocationIncluded?: boolean;
}

export interface RawTrainPosition {
  Train?: {
    AdvertisedTrainNumber?: string;
    OperationalTrainNumber?: string;
    OperationalTrainDepartureDate?: string;
    JourneyPlanNumber?: string;
    JourneyPlanDepartureDate?: string;
  };
  /** Last known position (3D WKT: "POINT (x y z)", X = longitude). */
  Position?: RawGeometry;
  /** When the position was measured. */
  TimeStamp?: string;
  Status?: { Active?: boolean };
  /** The train's absolute direction in degrees (the schema notes "bearing" is a misnomer). */
  Bearing?: number;
  /** Speed in km/h. */
  Speed?: number;
  /** Version number of this train's position. */
  VersionNumber?: number;
  ModifiedTime?: string;
  Deleted?: boolean;
}

export interface RawOperativeEvent {
  OperativeEventId?: string;
  CountyNo?: number[];
  EventType?: { Description?: string; EventTypeCode?: string };
  /** 1 = ongoing, 0 = ended. */
  EventState?: number;
  StartDateTime?: string;
  EndDateTime?: string;
  ModifiedDateTime?: string;
  EventSection?: Array<{ FromLocation?: RawEventLocation; ToLocation?: RawEventLocation; ViaLocation?: RawEventLocation }>;
  TrafficImpact?: Array<{
    Id?: string;
    StartDateTime?: string;
    EndDateTime?: string;
    ModifiedDateTime?: string;
    PublicMessage?: { Header?: string; Description?: string; StartDateTime?: string; EndDateTime?: string; ModifiedDateTime?: string };
    SelectedSection?: Array<{
      SectionLocation?: Array<{ Signature?: string; Affected?: boolean; LocationOrder?: number }>;
    }>;
  }>;
}

export interface RawRailwayEventLocation {
  Signature?: string;
  CountryCode?: string;
  LocationPrimaryCode?: string;
  LocationIncluded?: boolean;
}

export interface RawRailwayEvent {
  EventId?: string;
  StartDateTime?: string;
  EndDateTime?: string;
  /** Reason (cause) code for the event. */
  ReasonCode?: string;
  /** Id of the related OperativeEvent, if the event has become one. */
  OperativeEventId?: string;
  /** Ingen, MöjligOperativHändelse, BedömdEjOperativHändelse or OperativHändelse. */
  EventStatus?: string;
  Deleted?: boolean;
  Version?: number;
  CreatedDateTime?: string;
  ModifiedDateTime?: string;
  SelectedSection?: Array<{
    FromLocation?: RawRailwayEventLocation;
    ToLocation?: RawRailwayEventLocation;
    ViaLocation?: RawRailwayEventLocation;
    IntermediateLocation?: Array<{
      Signature?: string;
      CountryCode?: string;
      LocationPrimaryCode?: string;
      LocationOrder?: number;
    }>;
  }>;
  ModifiedTime?: string;
}

export interface RawDeviation {
  Id?: string;
  Header?: string;
  Message?: string;
  MessageType?: string;
  MessageCode?: string;
  SeverityCode?: number;
  SeverityText?: string;
  StartTime?: string;
  EndTime?: string;
  ValidUntilFurtherNotice?: boolean;
  RoadNumber?: string;
  RoadName?: string;
  LocationDescriptor?: string;
  PositionalDescription?: string;
  TrafficRestrictionType?: string;
  TemporaryLimit?: string;
  NumberOfLanesRestricted?: number;
  AffectedDirection?: string;
  CountyNo?: number[];
  CreationTime?: string;
  WebLink?: string;
  Geometry?: { Point?: RawGeometry; Line?: RawGeometry };
}

export interface RawSituation {
  Id?: string;
  PublicationTime?: string;
  ModifiedTime?: string;
  Deviation?: RawDeviation[];
}

export interface RawWeatherObservation {
  Id?: string;
  Sample?: string;
  Measurepoint?: { Id?: number; Name?: string; Geometry?: RawGeometry };
  Air?: {
    Temperature?: RawMeasured;
    RelativeHumidity?: RawMeasured;
    Dewpoint?: RawMeasured;
    VisibleDistance?: RawMeasured;
  };
  Wind?: Array<{ Direction?: RawMeasured; Speed?: RawMeasured }>;
  Surface?: {
    Temperature?: RawMeasured;
    Grip?: RawMeasured;
    Ice?: boolean;
    Snow?: boolean;
    Water?: boolean;
    IceDepth?: RawMeasured;
    WaterDepth?: RawMeasured;
  };
  Aggregated10minutes?: {
    Precipitation?: { Rain?: boolean; Snow?: boolean; TotalWaterEquivalent?: RawMeasured };
    Wind?: { SpeedAverage?: RawMeasured; SpeedMax?: RawMeasured };
  };
  Weather?: { Precipitation?: unknown };
}

/** A list element in the XSD (e.g. `<Stops><Stop/>...</Stops>`); accepted as the wrapper object or a bare array. */
export type RawList<Key extends string, T> = { [K in Key]?: T[] | T } | T[];

export interface RawReplacedTrain {
  AdvertisedTrainIdent?: string;
  /** Departure date of the replaced train, "YYYY-MM-DD". */
  ScheduledDepartureDate?: string;
  /** Product / operator of the replaced train. */
  ProductInformation?: string;
  TransportOperationalIdentifiers?: unknown;
}

export interface RawReplacementStop {
  StopId?: string;
  /** Trafikverket location signature of the stop. */
  PlaceSignature?: string;
  PrimaryLocationCode?: number;
  CountryCode?: string;
  /** Description of the departure, e.g. the destination shown to travellers. */
  AdvertisedDestination?: string;
  /** Description of the stop itself, e.g. "Busshållplats utanför stationshuset". */
  StopDescription?: string;
  StopPosition?: { Location?: { Longitude?: number; Latitude?: number } };
  PlannedArrivalTime?: string;
  ExpectedArrivalTime?: string;
  PlannedDepartureTime?: string;
  ExpectedDepartureTime?: string;
  Sequence?: number;
  DisembarkingOnly?: boolean;
  TravellerNote?: string;
  /** Actual arrival time. */
  VehicleStopArrival?: string;
  /** Actual departure time. */
  VehicleStopDeparture?: string;
  ConnectingStops?: RawList<'ConnectingStop', { PlaceSignature?: string; StopId?: string }>;
}

export interface RawReplacementTraffic {
  Source?: string;
  Id?: string;
  ReplacesTrains?: RawList<'ReplacesTrain', RawReplacedTrain>;
  Description?: string;
  VehicleIdentifier?: string;
  /** NeTEx vehicle mode: air, bus, coach, ferry, metro, rail, tram or taxi. */
  VehicleMode?: string;
  /** NeTEx status: planned, ordered, confirmed, running, finished or canceled. */
  Status?: string;
  WheelChair?: boolean;
  Toilet?: boolean;
  Stops?: RawList<'Stop', RawReplacementStop>;
  Deleted?: boolean;
  ModifiedTime?: string;
}

/* ---------- Processed output types ---------- */

export interface Station {
  signature: string;
  name: string;
  shortName?: string;
  officialName?: string;
  counties: number[];
  latitude?: number;
  longitude?: number;
}

export interface TrainAnnouncement {
  train?: string;
  direction?: 'departure' | 'arrival';
  operator?: string;
  product?: string;
  trafficType?: string;
  from: string[];
  to: string[];
  track?: string;
  advertisedTime?: string;
  estimatedTime?: string;
  estimatedTimeIsPreliminary?: boolean;
  actualTime?: string;
  delayMinutes?: number;
  canceled: boolean;
  deviations: string[];
  otherInformation: string[];
}

export interface TrainMessage {
  eventId?: string;
  eventType?: string;
  header?: string;
  description?: string;
  active: boolean;
  startTime?: string;
  endTime?: string;
  expectedEndTime?: string;
  lastUpdated?: string;
  counties: number[];
  affectedLocations: string[];
  fromLocations: string[];
  toLocations: string[];
}

export interface RailwayEventSection {
  from?: string;
  to?: string;
  via?: string;
  /** Locations between from and to, in timetable order. */
  intermediate: string[];
}

export interface RailwayEvent {
  eventId?: string;
  status?: string;
  reasonCode?: string;
  operativeEventId?: string;
  active: boolean;
  startTime?: string;
  endTime?: string;
  createdTime?: string;
  lastUpdated?: string;
  version?: number;
  sections: RailwayEventSection[];
  locations: string[];
}

export interface RoadSituation {
  id?: string;
  situationId?: string;
  header?: string;
  message?: string;
  messageType?: string;
  messageCode?: string;
  severity?: string;
  severityCode?: number;
  roadNumber?: string;
  roadName?: string;
  locationDescriptor?: string;
  positionalDescription?: string;
  trafficRestriction?: string;
  temporaryLimit?: string;
  lanesRestricted?: number;
  affectedDirection?: string;
  startTime?: string;
  endTime?: string;
  validUntilFurtherNotice?: boolean;
  counties: number[];
  point?: { latitude: number; longitude: number };
  lineWgs84?: string;
  distanceKm?: number;
  webLink?: string;
}

export interface RoadWeatherStation {
  id?: number;
  name?: string;
  latitude?: number;
  longitude?: number;
  distanceKm?: number;
  sampleTime?: string;
  airTemperatureC?: number;
  humidityPercent?: number;
  dewpointC?: number;
  visibilityMeters?: number;
  wind: Array<{ directionDegrees?: number; speedMs?: number }>;
  surface?: {
    temperatureC?: number;
    grip?: number;
    ice?: boolean;
    snow?: boolean;
    water?: boolean;
    iceDepthMm?: number;
    waterDepthMm?: number;
  };
  last10min?: {
    rain?: boolean;
    snow?: boolean;
    precipitationMm?: number;
    windAverageMs?: number;
    windMaxMs?: number;
  };
  precipitationType?: unknown;
}

export interface TrainPosition {
  train?: string;
  operationalTrainNumber?: string;
  departureDate?: string;
  latitude?: number;
  longitude?: number;
  distanceKm?: number;
  speedKmh?: number;
  bearingDegrees?: number;
  active?: boolean;
  timestamp?: string;
  ageMinutes?: number;
}

export interface ReplacementStop {
  name?: string;
  signature?: string;
  stopDescription?: string;
  destination?: string;
  latitude?: number;
  longitude?: number;
  plannedArrival?: string;
  expectedArrival?: string;
  actualArrival?: string;
  plannedDeparture?: string;
  expectedDeparture?: string;
  actualDeparture?: string;
  delayMinutes?: number;
  disembarkingOnly?: boolean;
  note?: string;
  connectsTo: string[];
}

export interface ReplacementTrip {
  id?: string;
  source?: string;
  description?: string;
  vehicleMode?: string;
  vehicleIdentifier?: string;
  status?: string;
  wheelchairAccessible?: boolean;
  toilet?: boolean;
  replacesTrains: Array<{ train?: string; departureDate?: string; product?: string }>;
  from?: string;
  to?: string;
  departureTime?: string;
  arrivalTime?: string;
  /** The stop at the requested station, when a station was given. */
  atStation?: ReplacementStop;
  stops: ReplacementStop[];
  lastUpdated?: string;
}
