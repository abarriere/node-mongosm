#!/usr/bin/env node


/* jshint -W004 */

var fs = require("fs"),
    options = require("options.js"),
    mongoose = require("schema/index.js"),
    entry;

var saxStream = require("sax").createStream(options.strict, options);
var db = mongoose.connect('mongodb://' + options.host + '/' + options.database);

var Node = db.model('node'),
    Way = db.model('way'),
    Relation = db.model('relation');

process.argv.forEach(function (val, index, array) {

  function logHelp () {
    console.log([
      ["-v", "verbose"],
      ["-f", "file path"],
      ["-l", "to lowercase"],
      ["-host", "host name"],
      ["-db", "database"],
      ["-h", "help"]
    ]);
  }

  if (index > 1) {
    switch (val) {
      case "-v":
        options.verbose = true;
        break;
      case "-l":
        options.lowercase = true;
        break;
      case "-f":
        options.filename = array.splice(index+1,1)[0];
        break;
      case "-host":
        options.host = array.splice(index+1,1)[0];
        break;
      case "-db":
        options.database = array.splice(index+1,1)[0];
        break;
      default:
        logHelp();
        process.kill()
        break;
    }
  }
});

mongoose.connection.on('open', function () {

  // TODO: add dots to show activity every 2 sec?
  saxStream.on("opentag", parse);
  fs.createReadStream(options.filename)
    .pipe(saxStream);

  saxStream.on("end", shutDown);

  saxStream.on("error", function (e) {
    console.error("error!", e);
    this._parser.error = null;
    this._parser.resume();
  });

});

function parse (xmlNode)  {

  switch(xmlNode.name)
  {
    
    case "node":
      if (!!entry) {
        save();
      }
      entry = new Node();
      var lat = parseFloat( xmlNode.attributes.lat.value );
      var lng = parseFloat( xmlNode.attributes.lon.value );
      entry.set("_id", xmlNode.attributes.id.value);
      entry.set("loc.coordinates", [lng,lat]);
      entry.set("loc.type", "Point");
      prepBaseNode(xmlNode);
      break;

    case "tag":
      var key   = "tags." + xmlNode.attributes.k.value.replace(/:/, "."),
          value = xmlNode.attributes.v.value;
      entry.set(key, value);
      break;

    case "nd":
      var ref = xmlNode.attributes.ref.value;
      var coord = entry.get("loc", Array) || [];
      coord.push(ref);
      entry.set("loc.coordinates",  coord);
      break;

    case "way":
      if (!!entry) {
        save();
      }
      entry = new Way();
      entry.set("_id", xmlNode.attributes.id.value);
      entry.set("loc",[]);
      prepBaseNode(xmlNode);
      break;

    case "member":
      var val = {};
      for (var attribute in xmlNode.attributes) {
        // TODO: this does not account for namespacing
        val[attribute] = xmlNode.attributes[attribute].value;
      }
      var coord = entry.get("loc.coordinates", Array) || [];

      // TODO: this should be an object not a string
      coord.push(JSON.stringify(val));
      entry.set("loc.coordinates", coord);
      break;

    case "relation":
      if (!!entry) {
        save();
      }
      entry = new Relation();
      entry.set("_id", xmlNode.attributes.id.value);
      entry.set("loc", {type:"MultiPolygon", coordinates: []});
      prepBaseNode(xmlNode);
      break;

    case "osm":
      var val = {};
      for (var attribute in xmlNode.attributes) {
        val[attribute] = xmlNode.attributes[attribute].value;
      }
      break;

    case "bounds":
      var val = {};
      for (var attribute in xmlNode.attributes) {
        val[attribute] = xmlNode.attributes[attribute].value;
      }
      break;

    default:
      console.log(xmlNode);
      break;
  }
  console.log(entry);
}

function prepBaseNode (xmlNode) { 

  if (!!options.useOriginalID) {
    entry.set("_id",  xmlNode.attributes.id.value);
  } else {
    entry.set("osm_id",  xmlNode.attributes.id.value);
  }

  entry.set("type",  xmlNode.name);
  for (var attribute in xmlNode.attributes) {
    if (attribute === "id" || attribute === "lat" || attribute === "lon") continue;
    entry.set(attribute, xmlNode.attributes[attribute].value);
  }
}

function shutDown() {
  save();
  mongoose.connection.close();
}

function save() {
  function handleError( err ) {
    if (!!options.suppressErrors) {
       console.log(err);
    }
  }

  function saveCB( err ) {
    if (!!err) handleError(err);
    if (!!options.verbose) {
      console.log(entry);
      console.log(entry,"\n\n################################################");
    }
  }
  function upsert () {
    var options = {upsert: true};
    var value = entry.toJSON();
    var query = {_id: value._id};
    delete value._id;
    mongoose
      .models[entry.type]
      .findOneAndUpdate(query, value, options, saveCB);
  }

  // TODO: determine and save loc.type as LineString, Polygon or Point
  if (!!options.upsert) {
    upsert();
  } else {
    entry.save(saveCB);
  }
}

