import { Point } from 'leaflet';
import { flatten, identical, complement, compose, head } from 'ramda';
import { Clipper, PolyFillType } from 'clipper-lib';
import createPolygon from 'turf-polygon';
import isIntersecting from 'turf-intersect';
import { polygonID } from '../FreeDraw';
import { createFor, removeFor } from './Polygon';
import { latLngsToClipperPoints } from './Simplify';
import { clearAllStacks } from './UndoRedo';

/**
 * @method fillPolygon
 * @param {Object} map
 * @param {Array} polygons
 * @param {Object} options
 * @return {Array}
 */
export function fillPolygon(map, polygon, options) {

    // Simplify the polygon which prevents voids in its shape.
    const points = latLngsToClipperPoints(map, polygon.getLatLngs()[0]);
    Clipper.SimplifyPolygon(points, PolyFillType.pftNonZero);
    const pid = polygon[polygonID];
    removeFor(map, polygon);

    // Convert the Clipper points back into lat/lng pairs.
    const latLngs = points.map(model => map.layerPointToLatLng(new Point(model.X, model.Y)));

    createFor(map, latLngs, options, true, pid, 0);

}

/**
 * @method latLngsToTuple
 * @param {Array} latLngs
 * @return {Array}
 */
function latLngsToTuple(latLngs) {
    return latLngs.map(model => [model.lat, model.lng]);
}

function returnIntersections(map, polygons) {
   // Transform a L.LatLng object into a GeoJSON polygon that TurfJS expects to receive.
    const toTurfPolygon = compose(createPolygon, x => [x], x => [...x, head(x)], latLngsToTuple);

    const analysis = polygons.reduce((accum, polygon) => {

        const latLngs = polygon.getLatLngs()[0];
        const points = latLngsToClipperPoints(map, polygon.getLatLngs()[0]);
        const turfPolygon = toTurfPolygon(latLngs);

        // Determine if the current polygon intersects any of the other polygons currently on the map.
        const intersects = polygons.filter(complement(identical(polygon))).some(polygon => {
            return Boolean(isIntersecting(turfPolygon, toTurfPolygon(polygon.getLatLngs()[0])));
        });

        const key = intersects ? 'intersecting' : 'rest';

        return {
            ...accum,
            [key]: [...accum[key], intersects ? points : latLngs],
            intersectingPolygons: intersects ? [...accum.intersectingPolygons, polygon] : accum.intersectingPolygons
        };

    }, { intersecting: [], rest: [], intersectingPolygons: [] });

    return analysis;
}

export function isIntersectingPolygon(map, polygons) {
    const analysis = returnIntersections(map, polygons);
    if (analysis.intersectingPolygons.length !== 0) {
        return true;
    }
    return false;
}

/**
 * @param {Object} map
 * @param {Array} polygons
 * @param {Object} options
 * @return {Array}
 */
export default (map, polygons, options) => {

    const analysis = returnIntersections(map, polygons);
    // Merge all of the polygons.
    const mergePolygons = Clipper.SimplifyPolygons(analysis.intersecting, PolyFillType.pftNonZero);

    // Not handling Self-Intersecting case .
    const updateStackState = !(mergePolygons.length > 1);
    // Also if Self-intersecting case found, clear all Stacks and Undo-Redo feature will not work until we have removed all Self-intersections.
    !updateStackState && clearAllStacks();

    // Remove all of the existing polygons that are intersecting another polygon.
    analysis.intersectingPolygons.forEach(polygon => removeFor(map, polygon));

    return flatten(mergePolygons.map(polygon => {

        // Determine if it's an intersecting polygon or not.
        const latLngs = polygon.map(model => {
            return map.layerPointToLatLng(new Point(model.X, model.Y));
        });

        // Create the polygon, but this time prevent any merging, otherwise we'll find ourselves
        // in an infinite loop.
        options.mergedFromPolygons = analysis.intersectingPolygons;
        options.currentOverlappingPolygon && (options.mergedFromPolygons = options.mergedFromPolygons.filter(polygon =>
            polygon[polygonID] !== options.currentOverlappingPolygon[polygonID]
        ));

        return createFor(map, latLngs, options, true, 0, 2, updateStackState); // pid = 0 bcoz to create new Polygon

    }));

};
