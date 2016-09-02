'use strict'
/**
 * Created by acastillo on 7/5/16.
 */
const OCLE = require('openchemlib-extended');

const Matrix = require('ml-matrix');
const newArray = require('new-array');
const defaultOptions = {nucleus:"H"};

class NmrPredictor2D {

    constructor(db) {
        this.db = db;
    }

    setDB(db){
        this.db = db;
    }

    predict(molfile, param1, param2) {

        var mol = molfile;
        if(typeof molfile === "string") {
            mol = OCLE.Molecule.fromMolfile(molfile);
            mol.addImplicitHydrogens();
        }

        if(typeof this.db === "object") {
            return this._askErno(mol, param1);
        }
        if(this.db === "spinus") {
            //The molfile whitout hydrogens
            return this._fromSpinus(mol, param1, param2);
        }
        if(this.db === "nmrshiftdb2") {
            return this._fromNnmrshiftdb2(mol, param1);
        }
    }

    /**
     * @function nmrShiftDBPred1H(molfile)
     * This function predict shift for 1H-NMR, from a molfile by using the cheminfo reference data base.
     * @param    molfile:string    A molfile content
     * @returns    +Object an array of NMRSignal1D
     */
    _askErno(mol, opt) {
        const options = Object.assign({},defaultOptions, opt);
        var currentDB = null;
        const nucleus = options.nucleus || "H";
        if (options.db) {
            currentDB = options.db;
        }
        else {
            if(!this.db)
                this.db =[[],[],[],[],[],[],[]];
            currentDB = this.db;
        }
        options.debug = options.debug || false;
        var algorithm = options.algorithm || 0;
        var levels = options.hoseLevels || [6,5,4,3,2];
        var couplings = options.getCouplings || false;
        levels.sort(function(a, b) {
            return b - a;
        });

        var diaIDs = mol.getGroupedDiastereotopicAtomIDs({atomLabel:nucleus});
        var infoCOSY = [];//mol.getCouplings();
        if(couplings) {
            //    infoCOSY = mol.predictCouplings();
        }

        var atoms = {};
        var atomNumbers = [];
        var i, k, j, atom, hosesString;
        for (j = diaIDs.length-1; j >=0; j--) {
            hosesString = OCLE.Util.getHoseCodesFromDiastereotopicID(diaIDs[j].oclID,  {maxSphereSize:levels[0], type: algorithm});
            atom = {
                diaIDs: [diaIDs[j].oclID + ""]
            };
            for(k=0; k < levels.length; k++) {
                atom["hose"+levels[k]] = hosesString[levels[k]-1]+"";
            }
            for (k = diaIDs[j].atoms.length - 1; k >= 0; k--) {
                atoms[diaIDs[j].atoms[k]] = JSON.parse(JSON.stringify(atom));
                atomNumbers.push(diaIDs[j].atoms[k]);
            }
        }
        //Now, we predict the chimical shift by using our copy of NMRShiftDB
        //var script2 = "select chemicalShift FROM assignment where ";//hose5='dgH`EBYReZYiIjjjjj@OzP`NET'";
        var toReturn = new Array(atomNumbers.length);
        for (j = 0; j < atomNumbers.length; j++) {
            atom = atoms[atomNumbers[j]];
            var res=null;
            k=0;
            //A really simple query
            while(res==null&&k<levels.length){
                if(currentDB[levels[k]]){
                    res = currentDB[levels[k]][atom["hose"+levels[k]]];
                }
                k++;
            }
            if (res == null) {
                res = { cs: -9999999, ncs: 0, std: 0, min: 0, max: 0 };//Default values
            }
            atom.level = levels[k-1];
            atom.delta = res.cs;
            atom.integral = 1;
            atom.atomIDs = ["" + atomNumbers[j]];
            atom.ncs = res.ncs;
            atom.std = res.std;
            atom.min = res.min;
            atom.max = res.max;
            atom.j = [];

            //Add the predicted couplings
            //console.log(atomNumbers[j]+" "+infoCOSY[0].atom1);
            for (i = infoCOSY.length - 1; i >= 0; i--) {
                if (infoCOSY[i].atom1 - 1 == atomNumbers[j] && infoCOSY[i].coupling > 2) {
                    atom.j.push({
                        "assignment": infoCOSY[i].atom2 - 1 + "",//Put the diaID instead
                        "diaID": infoCOSY[i].diaID2,
                        "coupling": infoCOSY[i].coupling,
                        "multiplicity": "d"
                    });
                }
            }
            toReturn[j]=atom;
        }
        //TODO this will not work because getPaths is not implemented yet!!!!
        if(options.ignoreLabile) {
            var linksOH = mol.getPaths(1,1,"H","O",false);
            var linksNH = mol.getPaths(1,1,"H","N",false);
            for(j = toReturn.length-1; j >= 0; j--) {
                for(var k = 0; k < linksOH.length; k++) {
                    if(toReturn[j].diaIDs[0] == linksOH[k].diaID1) {
                        toReturn.splice(j,1);
                        break;
                    }
                }
            }
            //console.log(h1pred.length);
            for(j = toReturn.length-1; j >= 0; j--) {
                for(var k = 0;k < linksNH.length; k++) {
                    if(toReturn[j].diaIDs[0] == linksNH[k].diaID1) {
                        toReturn.splice(j,1);
                        break;
                    }
                }
            }
        }

        return toReturn;
    }

    _fromSpinus(mol, result, options){
        //Convert to the ranges format and include the diaID for each atomID
        const data = this._spinusParser(result);
        const ids = data.ids;
        const jc = data.couplingConstants;
        const cs = data.chemicalShifts;
        const multiplicity = data.multiplicity;
        const integrals = data.integrals;

        const nspins = cs.length;

        const diaIDs = mol.getGroupedDiastereotopicAtomIDs({atomLabel:"H"});
        var result = new Array(nspins);
        var atoms = {};
        var atomNumbers = [];
        var i, j, k, oclID, tmpCS;
        var csByOclID = {};
        for (j = diaIDs.length-1; j >=0; j--) {
            oclID = diaIDs[j].oclID + "";
            for (k = diaIDs[j].atoms.length - 1; k >= 0; k--) {
                atoms[diaIDs[j].atoms[k]] = oclID;
                atomNumbers.push(diaIDs[j].atoms[k]);
                if(!csByOclID[oclID]){
                    csByOclID[oclID] = {nc:1, cs:cs[ids[diaIDs[j].atoms[k]]]};
                }
                else{
                    csByOclID[oclID].nc++;
                    csByOclID[oclID].cs+=cs[ids[diaIDs[j].atoms[k]]];
                }
            }
        }

        //Average the entries for the equivalent protons
        var idsKeys = Object.keys(ids);
        for (i = 0;i < nspins; i++) {
            tmpCS = csByOclID[atoms[idsKeys[i]]].cs/csByOclID[atoms[idsKeys[i]]].nc;
            result[i] = {atomIDs:[idsKeys[i]], diaIDs:[atoms[idsKeys[i]]], integral:integrals[i],
                delta:tmpCS, j:[]};
            for (j=0; j < nspins; j++) {
                if(jc[i][j] !== 0 ) {
                    result[i].j.push({
                        "assignment": idsKeys[j],
                        "diaID": atoms[ids[j]],
                        "coupling": jc[i][j],
                        "multiplicity": multiplicity[j]
                    });
                }
            }
        }

        return result;
    }

    _spinusParser(result){
        var lines = result.split('\n');
        var nspins = lines.length - 1;
        var cs = new Array(nspins);
        var integrals = new Array(nspins);
        var ids = {};
        var jc = Matrix.zeros(nspins, nspins);
        var i, j;

        for (i = 0; i < nspins; i++) {
            var tokens = lines[i].split('\t');
            cs[i] = +tokens[2];
            ids[tokens[0] - 1] = i;
            integrals[i] = 1;//+tokens[5];//Is it always 1??
        }

        for (i = 0; i < nspins; i++) {
            tokens = lines[i].split('\t');
            var nCoup = (tokens.length - 4) / 3;
            for (j = 0; j < nCoup; j++) {
                var withID = tokens[4 + 3 * j] - 1;
                var idx = ids[withID];
                jc[i][idx] = (+tokens[6 + 3 * j])/2;
            }
        }

        for (j = 0; j < nspins; j++) {
            for (i = j; i < nspins; i++) {
                jc[j][i] = jc[i][j];
            }
        }

        return {ids, chemicalShifts:cs, integrals, couplingConstants:jc, multiplicity: newArray(nspins, 2)};

    }

    //TODO implement the 13C chemical shift prediction
    _fromNnmrshiftdb2(molfile, options){
        return null;
    }
}


module.exports = NmrPredictor;